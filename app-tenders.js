// ===========================================================================
// app-tenders.js — Tender sheet, submission chain, materials, shop drawings, contracts, packages.
//
// index.html fetches these files and concatenates them in this fixed order:
//   core -> tenders -> schedule -> zone -> reports -> mount
// They share one scope, exactly as when everything lived in app.js.
// Function declarations hoist across the whole bundle, so the order only
// matters for the mount, which must come last.
// ===========================================================================

const TENDER_STEPS=[
  {key:"bidders",label:"Bidders list submission",opts:["—","N/A","Not Submitted","Submitted","Comments received","No comments received"],special:"bidders"},
  {key:"pkg",label:"Tender Package",opts:["—","N/A","Not needed","Not started","In preparation","Submitted","Approved"]},
  {key:"acc",label:"ACC/Aconex",opts:["—","N/A","Under preparation","Internal review ongoing","Pending client approval","Approved A","Approved B","Not Approved C","Rejected D"]},
  {key:"contract",label:"Contract",opts:["—","N/A","Request sent","In circulation","Signed"]},
  {key:"itp",label:"ITP",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"]},
  {key:"wms",label:"WMS",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"]},
  {key:"kickoff",label:"Kick off meeting",opts:["—","N/A","Not done","Scheduled","Held"]}
];
// Kick off meeting of a tender: a meeting, not a document. Held once its date is filled.
// na | held | planned (date set, not held yet) | none
function kickoffState(td){
  var v=((td&&td.steps)||{}).kickoff||"";
  var sd=(((td&&td.stepDates)||{}).kickoff)||{};
  if(v==="N/A")return "na";
  if(v==="Held"||isValidDate(sd.done))return "held";
  if(v==="Scheduled"||isValidDate(sd.target))return "planned";
  return "none";
}
// ---------------------------------------------------------------------------
// Theoretical dates.
//
// Each step carries two dates the user can see:
//   THEORETICAL - computed, an estimate of when the step will realistically happen
//   TARGET      - typed in a meeting; the commitment, and it may be EARLIER than the
//                 theoretical when the team can move faster
//
// The theoretical of a step is derived from the most reliable thing known about the
// step before it: its "done" date first, then its typed target, then its own
// theoretical. When the previous step is done, the estimate is no longer an estimate,
// so theoretical and target become the same date.
// ---------------------------------------------------------------------------
const THEORETICAL_CHAIN=[
  {key:"bidders", from:null,      days:0},
  {key:"pkg",     from:"bidders", days:7},
  {key:"acc",     from:"pkg",     days:7},
  {key:"contract",from:"acc",     days:28,useApproval:true},
  {key:"wms",     from:"contract",days:0, anchor:"startMinus"},
  {key:"itp",     from:"contract",days:0, anchor:"startMinus"},
  {key:"mar",     from:"contract",days:14}
];
function addCalDays(dateStr,days){
  if(!isValidDate(dateStr))return "";
  var d=new Date(dateStr);
  d.setDate(d.getDate()+Number(days||0));
  return toISO(d);
}
function theoreticalDates(td){
  var sd=(td&&td.stepDates)||{};
  var out={};
  function stepDate(k,f){return ((sd[k]||{})[f])||"";}
  THEORETICAL_CHAIN.forEach(function(st){
    var target=stepDate(st.key,"target");
    var theo="";
    var locked=false;                       // previous step is done -> no longer an estimate

    if(st.anchor==="startMinus"){
      // WMS / ITP hang off the start on site, not off the previous step
      var lead=st.key==="wms"?getDur("wmsBeforeStart"):getDur("itpBeforeStart");
      if(isValidDate(td.startOnSite))theo=addCalDays(td.startOnSite,-lead);
    }else if(!st.from){
      theo=target||"";
    }else{
      var prevDone=stepDate(st.from,"done");
      var prevApproval=stepDate(st.from,"approval");
      var base="";
      if(st.useApproval&&isValidDate(prevApproval)){base=prevApproval;locked=true;}
      else if(isValidDate(prevDone)){base=prevDone;locked=true;}
      else if(isValidDate(stepDate(st.from,"target")))base=stepDate(st.from,"target");
      else base=out[st.from]?out[st.from].theoretical:"";
      if(isValidDate(base))theo=addCalDays(base,st.days);
    }

    // A target typed on this step restarts the cascade from that date
    if(isValidDate(target))theo=locked?target:theo;
    out[st.key]={
      theoretical:theo,
      target:target,
      locked:locked,
      // what the rest of the app should use: the commitment if there is one
      effective:isValidDate(target)?target:theo
    };
  });
  return out;
}
const APPROVAL_OPTS=["—","N/A","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"];
// A step is approved as soon as the client returned an A or a B.
function isApprovedStatus(v){
  var t=String(v||"").toLowerCase();
  return t.indexOf("approved a")>=0||t.indexOf("approved b")>=0;
}
// ---------------------------------------------------------------------------
// Submission cycles.
//
// One document (ACC/Aconex, WMS, ITP, a material's MAR or MSS, one SD transmission) can go
// to the client several times. Each round trip is a cycle:
//   {id, rev, submitted, returned, code, comment}
// Code A or B = approved, the chain moves on. C or D = the document must be resubmitted,
// which opens the next cycle (R1, R2...).
//
// Where cycles live: td.cycles.acc|wms|itp, mat.cycles.mar|mss, sdTransmission.cycles.
// Old records have no cycles. They are READ as a single cycle R0 built from their legacy
// fields; nothing is written back until someone edits the document.
//
// Every write goes through the *WithCycles helpers below. They return ONE new object that
// carries the cycles AND the refreshed legacy fields (stepDates, steps, mar*/mss*, SD
// done/approvalDone/status), so the views that still read the legacy fields keep working.
// One object, one save: never two successive saves from the same state.
// ---------------------------------------------------------------------------
const CYCLE_CODES=[
  {k:"A",label:"Approved",            legacy:"Approved A",    approved:true },
  {k:"B",label:"Approved with comments",legacy:"Approved B",  approved:true },
  {k:"C",label:"Not approved",        legacy:"Not Approved C",approved:false},
  {k:"D",label:"Rejected",            legacy:"Rejected D",    approved:false}
];
function cycleCodeInfo(k){return CYCLE_CODES.find(function(c){return c.k===k;})||null;}
// Reads any status wording the app has ever stored and returns A, B, C, D or "".
function cycleCode(v){
  var t=String(v||"").toLowerCase().trim();
  if(!t)return"";
  if(t==="a"||t==="b"||t==="c"||t==="d")return t.toUpperCase();
  if(/not approved/.test(t))return"C";
  if(/reject/.test(t))return"D";
  if(/approved b\b/.test(t))return"B";
  if(/approved a\b/.test(t)||t==="approved")return"A";
  return"";
}
function cycleIsApproved(c){return !!c&&(c.code==="A"||c.code==="B");}
function newCycle(o){return Object.assign({id:uuid(),rev:0,submitted:"",returned:"",code:"",comment:""},o||{});}
// lv = the legacy fields as they are now. They mirror the last cycle, but the Submission
// steps table, the Materials and SD panels still write them directly: whatever was typed
// there is taken as the current state of the last revision.
function _readCycles(stored,legacy,lv){
  if(Array.isArray(stored)&&stored.length){
    var list=stored.map(function(c,i){return newCycle(Object.assign({rev:i},c));})
      .sort(function(a,b){return a.rev-b.rev;});
    if(lv){
      var L=list[list.length-1];
      // Old vocabularies only know approved / rejected: keep the stored A/B/C/D when the
      // legacy field says the same thing in fewer words.
      function fam(c){return c==="A"||c==="B"?"ok":c==="C"||c==="D"?"ko":"";}
      var code=lv.c&&fam(lv.c)===fam(L.code)?L.code:(lv.c||"");
      list[list.length-1]=Object.assign({},L,{submitted:lv.s||"",returned:lv.r||"",code:code});
    }
    return list;
  }
  return legacy?[legacy]:[];
}
function _legacyCycle(id,submitted,returned,code){
  if(!submitted&&!returned&&!code)return null;
  return newCycle({id:id,rev:0,submitted:submitted||"",returned:returned||"",code:code||"",legacy:true});
}
// --- readers --------------------------------------------------------------
function cyclesOfStep(td,k){
  var sd=((td&&td.stepDates)||{})[k]||{};
  var code=cycleCode(sd.approvalStatus)||cycleCode(((td&&td.steps)||{})[k]);
  return _readCycles(((td&&td.cycles)||{})[k],_legacyCycle("legacy-"+k,sd.done,sd.approval,code),{s:sd.done,r:sd.approval,c:code});
}
function cyclesOfMat(mat,kind){
  var m=mat||{};
  var c=cycleCode(m[kind+"Review"])||cycleCode(m[kind+"ApprovalStatus"])||cycleCode(m[kind+"Status"]);
  return _readCycles((m.cycles||{})[kind],
    _legacyCycle("legacy-"+kind,m[kind+"Done"],m[kind+"ApprovalDone"],c),{s:m[kind+"Done"],r:m[kind+"ApprovalDone"],c:c});
}
function cyclesOfSD(t){
  var x=t||{};
  var c=cycleCode(x.status);
  return _readCycles(x.cycles,_legacyCycle("legacy-sd",x.done,x.approvalDone,c),{s:x.done,r:x.approvalDone,c:c});
}
// --- editing --------------------------------------------------------------
// A new cycle can only be opened when the last one came back C or D.
function canAddCycle(cycles){
  if(!cycles.length)return true;
  var last=cycles[cycles.length-1];
  return last.code==="C"||last.code==="D";
}
function addCycle(cycles,o){
  if(!canAddCycle(cycles))return cycles;
  var rev=cycles.length?cycles[cycles.length-1].rev+1:0;
  return cycles.concat([newCycle(Object.assign({rev:rev},o||{}))]);
}
function updCycle(cycles,id,patch){
  return cycles.map(function(c){
    if(c.id!==id)return c;
    var n=Object.assign({},c,patch);delete n.legacy;return n;
  });
}
// Only the last cycle can be removed, so the revision numbers never get holes.
function delLastCycle(cycles){return cycles.slice(0,-1);}
function _cyClean(cycles){return cycles.map(function(c){var n=Object.assign({},c);delete n.legacy;return n;});}
// --- writers: cycles + legacy fields in one object ------------------------
// The legacy fields always mirror the LAST cycle: that is the live state of the document,
// and it is what calcProcurement / theoreticalDates already expect (an approval only ever
// sits on the last cycle, since a new cycle is opened only after a C or a D).
function _legacyStatus(last,pendingLabel){
  if(!last)return"—";
  var info=cycleCodeInfo(last.code);
  if(info)return info.legacy;
  return last.submitted?pendingLabel:"—";
}
function tdWithStepCycles(td,k,cycles){
  var last=cycles[cycles.length-1]||null;
  var sd=Object.assign({},td.stepDates||{});
  var cur=Object.assign({},sd[k]||{});
  cur.done=last?last.submitted:"";
  cur.approval=last?last.returned:"";
  cur.approvalStatus=last&&last.code?cycleCodeInfo(last.code).legacy:"";
  sd[k]=cur;
  var steps=Object.assign({},td.steps||{});
  steps[k]=_legacyStatus(last,k==="acc"?"Pending client approval":"Pending Approval");
  var cy=Object.assign({},td.cycles||{});cy[k]=_cyClean(cycles);
  return Object.assign({},td,{cycles:cy,stepDates:sd,steps:steps});
}
// Materials and SD speak "approved / rejected / pending approval"; the exact code goes in Review.
function _cyLegacyWord(last){
  if(!last)return"";
  if(last.code==="A"||last.code==="B")return"approved";
  if(last.code==="C"||last.code==="D")return"rejected";
  return last.submitted?"pending approval":"";
}
function matWithCycles(mat,kind,cycles){
  var last=cycles[cycles.length-1]||null;
  var w=_cyLegacyWord(last);
  var p={};
  p[kind+"Done"]=last?last.submitted:"";
  p[kind+"ApprovalDone"]=last?last.returned:"";
  p[kind+"ApprovalStatus"]=w==="approved"||w==="pending approval"?w:"";
  p[kind+"Status"]=w||(mat[kind+"Status"]==="under preparation"?"under preparation":"");
  p[kind+"Review"]=last&&last.code?(last.code==="D"?"Rejected":last.code):"";
  var cy=Object.assign({},mat.cycles||{});cy[kind]=_cyClean(cycles);
  p.cycles=cy;
  return Object.assign({},mat,p);
}
function sdWithCycles(t,cycles){
  var last=cycles[cycles.length-1]||null;
  return Object.assign({},t,{cycles:_cyClean(cycles),
    done:last?last.submitted:"",approvalDone:last?last.returned:"",
    status:_cyLegacyWord(last)});
}
// --- measures ---------------------------------------------------------------
function _cyDays(a,b){return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000);}
// reviewDays: time with the client, per cycle (open cycle counts up to today).
// turnDays:   time between a C/D return and the next submission (time with us / the sub).
function cycleStats(cycles,now){
  now=now||today();
  var out={count:cycles.length,revisions:Math.max(0,cycles.length-1),firstSubmitted:"",approvedOn:"",
    pending:false,reviewDays:[],turnDays:[],totalDays:null,firstTime:false};
  if(!cycles.length)return out;
  out.firstSubmitted=cycles[0].submitted||"";
  cycles.forEach(function(c,i){
    if(isValidDate(c.submitted))out.reviewDays.push(_cyDays(c.submitted,isValidDate(c.returned)?c.returned:now));
    var nx=cycles[i+1];
    if(nx&&isValidDate(c.returned)&&isValidDate(nx.submitted))out.turnDays.push(_cyDays(c.returned,nx.submitted));
  });
  var ok=cycles.find(cycleIsApproved);
  if(ok){out.approvedOn=ok.returned||"";out.firstTime=cycles.length===1;}
  var last=cycles[cycles.length-1];
  out.pending=!!last.submitted&&!last.code;
  if(isValidDate(out.firstSubmitted)&&isValidDate(out.approvedOn))out.totalDays=_cyDays(out.firstSubmitted,out.approvedOn);
  return out;
}

// ---------------------------------------------------------------------------
// Contract circuit.
//
// The stages come from Settings > Durations > Contract circuit (getContractCircuit). When a
// contract enters the circuit, the tender keeps a SNAPSHOT of the stage list, so changing the
// configuration later never rewrites a contract already in circulation.
//
// td.contractCircuit = {def:[stages], events:[{id, stageId, in, out, outcome, comment}]}
//   outcome "ok"       = the stage released the contract
//   outcome "returned" = sent back; the same stage gets a new event when it comes back
//
// Branches: start -> (internal ∥ sub) -> join -> end. The join stage only opens once both
// branches are complete. Legacy fields (stepDates.contract.requestDone / circulateDone /
// signedDone / signedAllDone and steps.contract) are refreshed on every write, by branch
// role, so a renamed or reordered circuit still feeds calcProcurement correctly.
// ---------------------------------------------------------------------------
function newCircuitEvent(o){return Object.assign({id:uuid(),stageId:"",in:"",out:"",outcome:"",comment:""},o||{});}
function _circuitLegacyEvents(def,ct){
  var ev=[];
  function st(br,first){var l=def.filter(function(s){return s.branch===br;});return first?l[0]:l[l.length-1];}
  var start=st("start",true),firstIn=st("internal",true),join=st("join",true),end=st("end",false);
  if(start&&ct.requestDone)ev.push(newCircuitEvent({id:"legacy-req",stageId:start.id,in:ct.requestDone,out:ct.requestDone,outcome:"ok",legacy:true}));
  if(firstIn&&ct.circulateDone)ev.push(newCircuitEvent({id:"legacy-circ",stageId:firstIn.id,in:ct.circulateDone,legacy:true}));
  if(join&&ct.signedDone)ev.push(newCircuitEvent({id:"legacy-sign",stageId:join.id,in:ct.signedDone,out:ct.signedDone,outcome:"ok",legacy:true}));
  if(end&&ct.signedAllDone)ev.push(newCircuitEvent({id:"legacy-signall",stageId:end.id,in:ct.signedAllDone,out:ct.signedAllDone,outcome:"ok",legacy:true}));
  return ev;
}
function circuitOf(td){
  var cc=(td&&td.contractCircuit)||null;
  if(cc&&Array.isArray(cc.def)&&cc.def.length)
    return {def:cc.def,events:(cc.events||[]).map(newCircuitEvent),stored:true};
  var def=getContractCircuit();
  var ct=((td&&td.stepDates)||{}).contract||{};
  return {def:def,events:_circuitLegacyEvents(def,ct),stored:false};
}
// Per stage: its passages, total days spent, number of returns, and a state:
// done | current | returned | blocked (join waiting for a branch) | todo
function circuitState(cc,now){
  now=now||today();
  var def=cc.def,ev=cc.events;
  var byStage={};
  def.forEach(function(s){byStage[s.id]=ev.filter(function(e){return e.stageId===s.id;});});
  function stageDone(s){var l=byStage[s.id];var x=l[l.length-1];return !!x&&x.outcome==="ok"&&!!x.out;}
  function branchDone(br){var l=def.filter(function(s){return s.branch===br;});return l.length===0||l.every(stageDone);}
  var stages=def.map(function(s){
    var l=byStage[s.id],last=l[l.length-1];
    var days=l.reduce(function(n,e){return isValidDate(e.in)?n+_cyDays(e.in,isValidDate(e.out)?e.out:now):n;},0);
    var returns=l.filter(function(e){return e.outcome==="returned";}).length;
    var state="todo";
    if(last&&last.outcome==="ok"&&last.out)state="done";
    else if(last&&last.outcome==="returned")state="returned";
    else if(last&&last.in)state="current";
    if(state==="todo"&&s.branch==="join"&&!(branchDone("internal")&&branchDone("sub")))state="blocked";
    var late=s.days>0&&days>s.days;
    return {stage:s,events:l,days:days,returns:returns,state:state,late:late,since:last&&last.in&&!last.out?last.in:""};
  });
  var first=ev.filter(function(e){return isValidDate(e.in);}).map(function(e){return e.in;}).sort()[0]||"";
  var endSt=stages.filter(function(x){return x.stage.branch==="end";}).pop();
  var signedAll=endSt&&endSt.state==="done"?endSt.events[endSt.events.length-1].out:"";
  return {stages:stages,current:stages.filter(function(x){return x.state==="current";}),
    started:first,signedAll:signedAll,
    totalDays:first?_cyDays(first,signedAll||now):null,
    internalDone:branchDone("internal"),subDone:branchDone("sub")};
}
function tdWithCircuit(td,cc){
  var def=cc.def,ev=cc.events.map(function(e){var n=Object.assign({},e);delete n.legacy;return n;});
  var full={def:def,events:ev};
  var st=circuitState(full);
  function lastOut(br){var x=st.stages.filter(function(s){return s.stage.branch===br;}).pop();return x&&x.state==="done"?x.events[x.events.length-1].out:"";}
  var firstInternal=st.stages.filter(function(s){return s.stage.branch==="internal";})[0];
  var circ=firstInternal&&firstInternal.events[0]?firstInternal.events[0].in:"";
  var sd=Object.assign({},td.stepDates||{});
  var ct=Object.assign({},sd.contract||{});
  ct.requestDone=lastOut("start");ct.circulateDone=circ;ct.signedDone=lastOut("join");ct.signedAllDone=lastOut("end");
  sd.contract=ct;
  var steps=Object.assign({},td.steps||{});
  steps.contract=ct.signedAllDone?"Signed":circ?"In circulation":ct.requestDone?"Request sent":(steps.contract||"—");
  return Object.assign({},td,{contractCircuit:full,stepDates:sd,steps:steps});
}

// ---------------------------------------------------------------------------
// Bidders: structured list {id, name, price, techScore, result, comment}.
// Until someone edits it, an old tender's free-text list (stepComments.bidders) is read
// one name per line, without prices.
// result: "" | "awarded" | "declined" | "withdrawn"
// ---------------------------------------------------------------------------
function newBidder(o){return Object.assign({id:uuid(),name:"",price:"",techScore:"",result:"",comment:""},o||{});}
function biddersOf(td){
  if(Array.isArray(td&&td.bidders))return td.bidders.map(newBidder);
  var txt=String(((td&&td.stepComments)||{}).bidders||"");
  return txt.split(/\r?\n|;/).map(function(s){return s.replace(/^[\s\-•*\d.)]+/,"").trim();})
    .filter(Boolean).map(function(n,i){return newBidder({id:"legacy-b"+i,name:n,legacy:true});});
}

// ---------------------------------------------------------------------------
// Every document of a tender that goes to the client, in one list.
//
// tenderDocs(td) -> [{id, group, kind, label, sub, cycles, theoSub, theoApproval, patchFor(list)}]
//   theoSub / theoApproval: the contractual (theoretical) dates, from theoreticalDates and
//     Settings > Durations. "VS theo" compares the real approval (or today) to theoApproval.
//   patchFor(list): the ONE patch to pass to updTd when this document's revisions change.
//     It carries the cycles and refreshes every legacy field that other views read.
// ---------------------------------------------------------------------------
function _sdAggregate(list){
  // The tender-level SD fields feed calcProcurement: first submission of any transmission,
  // and the last approval once every transmission is approved.
  var p={};
  if(!list.length)return p;
  var st=list.map(function(t){return cycleStats(cyclesOfSD(t));});
  var firsts=st.map(function(x){return x.firstSubmitted;}).filter(isValidDate).sort();
  var allOk=st.every(function(x){return !!x.approvedOn;});
  var anyBack=list.some(function(t){var l=cyclesOfSD(t);var z=l[l.length-1];return z&&(z.code==="C"||z.code==="D");});
  var anyPending=st.some(function(x){return x.pending;});
  p.sdDone=firsts[0]||"";
  p.sdApprovalDone=allOk?st.map(function(x){return x.approvedOn;}).filter(isValidDate).sort().pop()||"":"";
  p.sdStatus=allOk?"approved":anyBack?"rejected":anyPending?"pending approval":(p.sdDone?"submitted":"");
  p.sdApprovalStatus=allOk?"approved":anyPending?"pending approval":"";
  return p;
}
function cyclesOfSdMain(td){
  var x=td||{};
  var c=cycleCode(x.sdReview)||cycleCode(x.sdApprovalStatus)||cycleCode(x.sdStatus);
  return _readCycles(x.sdCycles,_legacyCycle("legacy-sdm",x.sdDone,x.sdApprovalDone,c),{s:x.sdDone,r:x.sdApprovalDone,c:c});
}
function sdMainWithCycles(td,list){
  var last=list[list.length-1]||null;
  var w=_cyLegacyWord(last);
  return {sdCycles:_cyClean(list),sdDone:last?last.submitted:"",sdApprovalDone:last?last.returned:"",
    sdStatus:w||(td.sdStatus==="under preparation"?"under preparation":""),
    sdApprovalStatus:w==="approved"||w==="pending approval"?w:"",
    sdReview:last&&last.code?(last.code==="D"?"Rejected":last.code):""};
}
// ---------------------------------------------------------------------------
// Client approval route of the subcontract, from its amount (Settings › Durations):
//   below subAccMin (25 000 €)     → "none": internal approval only, nothing goes to the client
//   from subAccMin up to subAconexMin (200 000 €) → "acc"
//   from subAconexMin              → "aconex"
// The amount is the proposed ACC amount, else the awarded bidder, else the lowest bid, else
// the budget. td.approvalRoute ("acc" | "aconex" | "none") overrides; missing = automatic.
// It is still ONE document (td.cycles.acc / stepDates.acc): only its name and whether it goes
// to the client change, so the existing history and the contract chain are untouched.
// ---------------------------------------------------------------------------
var APPROVAL_ROUTE_LABEL={acc:"ACC",aconex:"Aconex",none:"Internal approval"};
function tenderApprovalAmount(td){
  var proposed=Number((td&&td.accAmountSubcontract)||0)+Number((td&&td.accAmountOther)||0);
  if(proposed>0)return{amount:proposed,src:"proposed ACC amount"};
  var bl=biddersOf(td||{});
  var aw=bl.find(function(b){return b.result==="awarded"&&Number(b.price)>0;});
  if(aw)return{amount:Number(aw.price),src:"awarded bid"};
  var ps=bl.map(function(b){return Number(b.price)||0;}).filter(function(x){return x>0;});
  if(ps.length)return{amount:Math.min.apply(null,ps),src:"lowest bid"};
  if(Number((td&&td.budget)||0)>0)return{amount:Number(td.budget),src:"budget"};
  return{amount:null,src:""};
}
function tenderApprovalRoute(td){
  var a=tenderApprovalAmount(td);
  var accMin=getDur("subAccMin"),acoMin=getDur("subAconexMin");
  var auto=a.amount===null?"":a.amount>=acoMin?"aconex":a.amount>=accMin?"acc":"none";
  var why=a.amount===null?"Amount unknown: fill the budget, the bids or the proposed ACC amount"
    :momEur(a.amount)+" ("+a.src+") → "+(auto==="aconex"?"≥ "+momEur(acoMin):auto==="acc"?momEur(accMin)+" – "+momEur(acoMin):"< "+momEur(accMin));
  var ov=td&&td.approvalRoute;
  var route=ov==="acc"||ov==="aconex"||ov==="none"?ov:auto;
  return{route:route,auto:auto,manual:route!==auto,amount:a.amount,why:why};
}
// "ACC", "Aconex", "Internal approval" — or "ACC/Aconex" while the amount is unknown.
function tenderRouteLabel(td){var r=tenderApprovalRoute(td).route;return APPROVAL_ROUTE_LABEL[r]||"ACC/Aconex";}
function tenderDocs(td){
  var T=(function(){try{return theoreticalDates(td);}catch(e){return{};}})();
  function th(k){return ((T[k]||{}).theoretical)||"";}
  var out=[];
  // client approval and quality documents live in stepDates / steps
  var route=tenderApprovalRoute(td).route;
  // A document already sent keeps a client name even if the amount later fell below the ACC threshold.
  var accLabel=route==="none"&&cyclesOfStep(td,"acc").length?"ACC/Aconex":tenderRouteLabel(td);
  [{k:"acc",group:"Client approval",label:accLabel},{k:"wms",group:"Quality",label:"WMS"},{k:"itp",group:"Quality",label:"ITP"}].forEach(function(d){
    // Below the ACC threshold nothing goes to the client: no document, unless one was already sent.
    if(d.k==="acc"&&route==="none"&&!cyclesOfStep(td,"acc").length)return;
    var sub=th(d.k);
    out.push({id:d.k,group:d.group,kind:d.k,label:d.label,sub:(((td.stepDates||{})[d.k])||{}).reference||"",
      cycles:cyclesOfStep(td,d.k),theoSub:sub,
      theoApproval:isValidDate(sub)?(d.k==="acc"?addWorkingDays(sub,getDur("accApproval")):addCalDays(sub,getDur("clientResponse"))):"",
      patchFor:function(list){var n=tdWithStepCycles(td,d.k,list);return {cycles:n.cycles,stepDates:n.stepDates,steps:n.steps};}});
  });
  // shop drawings: one document per transmission
  var ct=(td.stepDates||{}).contract||{};
  var ctBase=ct.signedDone||ct.signedAllDone||th("contract");
  var sdSub=isValidDate(ctBase)?addWorkingDays(ctBase,getDur("sdAfterContract")):"";
  // The approval is expected from the submission date actually planned: the transmission's
  // own target, then the tender's SD target, then the computed one.
  (td.sdTransmissions||[]).forEach(function(t,i){
    var tSub=t.target||td.sdTarget||sdSub;
    out.push({id:"sd:"+t.id,group:"Shop drawings",kind:"sd",label:t.ref||("SD "+(i+1)),sub:t.description||"",
      cycles:cyclesOfSD(t),theoSub:tSub,
      theoApproval:isValidDate(tSub)?addWorkingDays(tSub,getDur("sdApproval")):"",
      patchFor:function(list){
        var tl=(td.sdTransmissions||[]).map(function(x){return x.id===t.id?sdWithCycles(x,list):x;});
        return Object.assign({sdTransmissions:tl},_sdAggregate(tl));
      }});
  });
  // Tenders followed without transmissions keep their shop drawings at tender level
  // (sdDone / sdApprovalDone / sdStatus / sdReview). They are one document, "SD".
  if(!(td.sdTransmissions||[]).length&&(td.hasSD||td.sdDone||td.sdApprovalDone||td.sdStatus||(td.sdCycles||[]).length)){
    out.push({id:"sd:_main",group:"Shop drawings",kind:"sd",label:"SD",sub:"whole tender",
      cycles:cyclesOfSdMain(td),theoSub:td.sdTarget||sdSub,
      theoApproval:isValidDate(td.sdTarget||sdSub)?addWorkingDays(td.sdTarget||sdSub,getDur("sdApproval")):"",
      patchFor:function(list){return sdMainWithCycles(td,list);}});
  }
  // materials: the MAR, and the MSS when the material needs one (or already has a history).
  // Same builder and same theoretical date as the Materials table: see matDoc / matDocTheo.
  var marSub=matDocTheo(td).date;
  (td.materials||[]).forEach(function(m,i){
    var kinds=matDocKinds(m);
    ["mar","mss"].forEach(function(kd){
      if(kinds.indexOf(kd)>=0)out.push(matDoc(td,m,i,kd,marSub));
    });
  });
  // purchases: the ACC and the Aconex of each purchase, when its amount requires them
  (td.purchases||[]).forEach(function(p){
    PURCHASE_DOCS.forEach(function(x){if(purchaseNeeds(p,x.k))out.push(purchaseDoc(td,p,x.k));});
  });
  return out;
}
var DOC_GROUPS=["Client approval","Shop drawings","Materials","Purchases","Quality"];
// ACC-like documents follow the ACC clock (working days); every other the calendar one.
function docAccClock(kind){return kind==="acc"||kind==="pacc"||kind==="paconex";}
function isPurchaseDoc(d){return !!d&&(d.kind==="pacc"||d.kind==="paconex");}
// The short name of a document in actions and the Stage column.
function docShortName(d){
  if(d.kind==="mar"||d.kind==="mss"||isPurchaseDoc(d))return d.label+" "+d.sub;
  if(d.kind==="sd")return d.id==="sd:_main"?"SD":"SD "+d.label;
  return d.label;
}
// When the client's answer is due for a submitted revision, and how late it is.
// ACC follows accApproval in working days; every other document clientResponse in calendar days.
// The overdue count uses the same unit as the due date: "wd" (working) or "d" (calendar).
function docResponseDue(doc,submitted){
  if(!isValidDate(submitted))return"";
  return docAccClock(doc.kind)?addWorkingDays(submitted,getDur("accApproval")):addCalDays(submitted,getDur("clientResponse"));
}
function docOverdue(doc,submitted,now){
  now=now||today();
  var due=docResponseDue(doc,submitted);
  if(!isValidDate(due)||!(now>due))return null;
  var n=docAccClock(doc.kind)?countWorkingDays(due,now):Math.round((parseISODate(now)-parseISODate(due))/86400000);
  return n>0?{days:n,unit:docAccClock(doc.kind)?"wd":"d",due:due}:null;
}
function fmtOverdue(o){return o?o.days+" "+o.unit+" overdue":"";}
function OverdueTag({o,lead}){
  if(!o)return null;
  return <span title={"Client answer was due "+fmtDate(o.due)+(o.unit==="wd"?" (working days)":" (calendar days)")}
    style={{color:"#b3302a",fontWeight:700}}>{lead===false?"":" · "}{fmtOverdue(o)}</span>;
}
// Where a document stands today.
//   state: none | pending | returned | approved
//   vsTheo: days between the real approval (or today) and the contractual approval;
//           positive = late. null when there is no contractual date.
function docSummary(doc,now){
  now=now||today();
  var l=doc.cycles,last=l[l.length-1],st=cycleStats(l,now);
  // A code counts even without dates: old records often have "Approved A" and nothing else.
  var state=!last?"none":last.code==="A"||last.code==="B"?"approved":last.code?"returned":last.submitted?"pending":"none";
  var since=last&&last.returned?last.returned:last&&last.submitted?last.submitted:"";
  var daysSince=isValidDate(since)?Math.round((new Date(now)-new Date(since))/86400000):null;
  var text;
  if(state==="approved")text=(cycleCodeInfo(last.code)||{}).label+" · "+fmtDate(last.returned);
  else if(state==="returned")text=(cycleCodeInfo(last.code)||{}).label+" · to resubmit, "+daysSince+" d";
  else if(state==="pending")text="With client"+(last.rev?" R"+last.rev:"")+" · "+daysSince+" d";
  else text="Not submitted"+(isValidDate(doc.theoSub)?" · due "+fmtDate(doc.theoSub):"");
  var end=state==="approved"?st.approvedOn:now;
  var vs=null;
  if(isValidDate(doc.theoApproval)&&(state!=="none"||doc.theoApproval<now))
    vs=Math.round((new Date(end)-new Date(doc.theoApproval))/86400000);
  var total=isValidDate(st.firstSubmitted)?Math.round((new Date(st.approvedOn||now)-new Date(st.firstSubmitted))/86400000):null;
  var overdue=state==="pending"?docOverdue(doc,last.submitted,now):null;
  return {state:state,text:text,overdue:overdue,rev:last?last.rev:null,codes:l.map(function(c){return c.code;}),vsTheo:vs,total:total,stats:st};
}

// ---------------------------------------------------------------------------
// Automatic actions for documents and the contract circuit.
// Compares a tender before and after an edit made in Flow & history and returns the new
// task list (or null when nothing changes), so the caller saves tasks ONCE.
//   submitted (R0 or a resubmission) -> close "Submit…"/"Resubmit…", open "Get approval…"
//   ACC first submitted                -> also open "Contract Request to be sent"
//   returned C/D                      -> close "Get approval…", open "Resubmit…"
//   approved A/B                      -> close "Get approval…" and "Resubmit…"
//   contract desks                    -> close the request / circulate / sign actions
// ---------------------------------------------------------------------------
function flowTaskChanges(prevTd,nextTd,tasks,owner,now){
  now=now||today();
  var list=(tasks||[]).slice(),changed=false;
  var title=nextTd.title||"";
  function find(text,open){return list.findIndex(function(t){return t.tenderRef===nextTd.id&&t.text===text&&(open?t.status!=="done":true);});}
  function close(text){var i=find(text,true);if(i>=0){list[i]=Object.assign({},list[i],{status:"done",completedAt:now});changed=true;}}
  function open(text,o){
    if(find(text,true)>=0)return;
    var i=find(text,false);
    if(i>=0&&list[i].addedBy==="System"){list[i]=Object.assign({},list[i],{status:"pending",completedAt:""},o||{});changed=true;return;}
    list.unshift(newTask(Object.assign({text:text,owner:owner,tenderRef:nextTd.id,package:nextTd.package||"",status:"pending",
      importance:3,note:"Auto — Flow & history",addedBy:"System"},o||{})));changed=true;
  }
  function tagFor(kind){return docAccClock(kind)?"Procurement":qualityTag(nextTd.package||"");}
  var before={};tenderDocs(prevTd).forEach(function(d){before[d.id]=docSummary(d,now);});
  tenderDocs(nextTd).forEach(function(d){
    var a=before[d.id]||{state:"none",rev:null},b=docSummary(d,now);
    if(a.state===b.state&&a.rev===b.rev)return;
    var name=docShortName(d);
    var getAppr=d.kind==="acc"?"Get the approval of the Tender result from the client — "+title:"Get approval for "+name+" — "+title;
    var resub="Resubmit "+name+" — "+title;
    var submitTxt=d.kind==="acc"?"Submit the Tender Result — "+title:d.kind==="wms"?"Submit the WMS — "+title:d.kind==="itp"?"Submit the ITP — "+title:
      (d.kind==="mar"||d.kind==="mss")?"Prepare the "+d.label+": "+(d.sub||"material")+" — "+title:
      isPurchaseDoc(d)?"Submit the "+name+" — "+title:"Prepare the SD — "+title;
    var last=d.cycles[d.cycles.length-1]||{};
    if(b.state==="pending"){
      close(submitTxt);close(resub);
      var due=docResponseDue(d,last.submitted);
      open(getAppr,{due:due,tags:[tagFor(d.kind)],urgence:calcProcurementUrgence(due)});
      if(d.kind==="acc"&&a.state==="none"&&!(((nextTd.stepDates||{}).contract)||{}).requestDone)
        open("Contract Request to be sent — "+title,{tags:["Contract"]});
    }else if(b.state==="returned"){
      close(getAppr);
      var due2=addCalDays(now,7);
      open(resub,{due:due2,tags:[tagFor(d.kind)],urgence:calcProcurementUrgence(due2),note:"Auto — returned "+last.code+(last.comment?": "+last.comment:"")});
    }else if(b.state==="approved"){
      close(getAppr);close(resub);close(submitTxt);
    }
  });
  var pc=((prevTd.stepDates||{}).contract)||{},nc=((nextTd.stepDates||{}).contract)||{};
  if(nc.requestDone&&!pc.requestDone)close("Contract Request to be sent — "+title);
  if(nc.circulateDone&&!pc.circulateDone)close("Contract to circulate — "+title);
  if((nc.signedDone||nc.signedAllDone)&&!(pc.signedDone||pc.signedAllDone))close("Contract to be signed internally and by the sub — "+title);
  return changed?list:null;
}

function tenderStepClass(step,val){
  if(!val||val==="—")return"s-default";
  if(val==="N/A")return"s-na";
  var v=val.toLowerCase();
  if(v==="not approved"||v.includes("reject")||v.includes("not done"))return"s-notdone";
  if(v==="approved a"||v==="approved b"||v==="approved"||v==="signed"||v==="held")return"s-approved-a";
  if(v==="scheduled")return"s-pending";
  if(v.includes("pending")||v.includes("ongoing")||v.includes("circulation")||v.includes("sent")||v.includes("preparation")||v.includes("submitted")||v.includes("request")||v.includes("bids"))return"s-pending";
  return"s-default";
}

// Defaults
function parseLeadDays(str){
  if(!str)return 0;
  var s=String(str).toLowerCase().trim();
  var n=parseFloat(s)||0;
  if(!n)return 0;
  if(s.includes("week")||s.includes("sem")||s.includes("wk")||s.includes("sem"))return Math.round(n*6);
  if(s.includes("month")||s.includes("mois"))return Math.round(n*26);
  return Math.round(n);
}
// A shop-drawing transmission: one submission to the client, carrying one or more drawing
// numbers. Both shapes the site actually uses are covered — several drawings sent together
// as one transmission (sub-lines), and several transmissions over time (one line each).
function newSDTransmission(o){
  return Object.assign({id:uuid(),ref:"",description:"",target:"",done:"",approvalDone:"",
    status:"",numbers:[]},o||{});
}
function SDPanel({td,updTd,tenders,saveTenders,setSelTender,people,afterSave,focus}){
  var list=td.sdTransmissions||[];
  const [openIds,setOpenIds]=useState({});
  // Revisions (R0, R1… codes A/B/C/D) are edited here, under each transmission: one place per document.
  const [revOpen,setRevOpen]=useState({});
  function toggleRev(id){setRevOpen(function(o){var n=Object.assign({},o);n[id]=!o[id];return n;});}
  useEffect(function(){
    if(!focus||!/^sd:/.test(focus.id))return;
    setRevOpen(function(o){var n=Object.assign({},o);n[focus.id]=true;return n;});
    scrollToDoc(focus.id);
  },[focus&&focus.n]);
  function docCell(id){
    var d=flowDocOf(td,id);if(!d)return null;
    var st=docSummary(d).state;
    return <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
      <button type="button" onClick={function(){toggleRev(id);}} title="Show or edit the revisions"
        style={{background:"none",border:"none",cursor:"pointer",padding:0,fontSize:11,color:"#8b8578",fontFamily:"inherit"}}>{revOpen[id]?"▾":"▸"}</button>
      <FlowDocBadge td={td} id={id}/>
      {st==="none"&&<button type="button" className="btn btn-sm" style={{fontSize:10,padding:"1px 7px"}}
        onClick={function(){recordDocSubmission(td,d,updTd,afterSave).then(function(p){if(p)setRevOpen(function(o){var n=Object.assign({},o);n[id]=true;return n;});});}}>＋ Record</button>}
    </div>;
  }
  function revRow(id,span){
    if(!revOpen[id])return null;
    var d=flowDocOf(td,id);if(!d)return null;
    return <tr><td colSpan={span} style={{background:"#faf9f6",padding:"6px 12px 10px 24px"}}>
      <DocRevisionsEditor td={td} d={d} updTd={updTd} afterSave={afterSave}/>
    </td></tr>;
  }
  const SD_OPTS=["","under preparation","submitted","pending approval","approved","rejected"];
  const SD_LABELS={"":"— status —","under preparation":"Under preparation","submitted":"Submitted",
    "pending approval":"Pending approval","approved":"✅ Approved","rejected":"❌ Rejected"};
  function col(st){
    return st==="approved"?"var(--green,#1e6b3a)":st==="rejected"?"var(--red,#b3302a)"
      :(st==="submitted"||st==="pending approval")?"var(--amber,#b35c00)"
      :st==="under preparation"?"var(--blue,#0f5299)":"var(--ink-3,#6f6b62)";
  }
  function save(next){updTd("sdTransmissions",next);}
  function updT(i,patch){save(list.map(function(x,j){return j!==i?x:Object.assign({},x,patch);}));}
  function delT(i){
    var t=list[i];
    if(!safeConfirm("Delete transmission "+((t&&t.ref)||"#"+(i+1))+" and its "+((t&&t.numbers)||[]).length+" drawing number(s)?"))return;
    save(list.filter(function(_,j){return j!==i;}));
  }
  function addNum(i){
    var t=list[i];
    updT(i,{numbers:[...(t.numbers||[]),{id:uuid(),number:"",description:""}]});
    setOpenIds(Object.assign({},openIds,{[t.id]:true}));
  }

  return <div style={{marginBottom:10}}>
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)",flexWrap:"wrap"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Shop drawings</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
        one line per transmission · several drawing numbers inside each{list.length>0?" · "+list.length+" transmission"+(list.length!==1?"s":""):""}</span>
      <button className="btn btn-sm" style={{marginLeft:"auto"}}
        onClick={function(){save([...(list),newSDTransmission()]);}}>＋ Transmission</button>
    </div>

    {list.length===0&&!flowDocOf(td,"sd:_main")&&<div style={{fontSize:12,color:"var(--ink-4,#9b968b)",padding:"4px 2px"}}>
      No transmission yet. Add one when a set of drawings goes to the client.</div>}
    {list.length===0&&flowDocOf(td,"sd:_main")&&<table className="tbl" style={{fontSize:12}}><tbody>
      <tr id="tdoc-sd:_main"><td style={{fontWeight:600,width:200}}>Whole tender (no transmission)</td><td>{docCell("sd:_main")}</td></tr>
      {revRow("sd:_main",2)}
    </tbody></table>}

    {list.length>0&&<table className="tbl" style={{fontSize:12}}>
      <thead><tr>
        <th style={{width:34}}></th>
        <th style={{minWidth:120}}>Transmission ref</th>
        <th style={{minWidth:180}}>Description</th>
        <th style={{textAlign:"center",minWidth:112}}>Target</th>
        <th style={{minWidth:220}} title="▸ opens the revisions (R0, R1…, codes A/B/C/D)">Submissions</th>
        <th style={{width:34}}></th>
      </tr></thead>
      <tbody>{list.map(function(t,i){
        var nums=t.numbers||[];
        var open=!!openIds[t.id];
        var answered=t.status==="approved"||t.status==="rejected"||!!t.approvalDone;
        var due=t.done?addCalDays(t.done,getDur("clientResponse")):"";
        var overdue=!answered&&due&&due<today();
        return <React.Fragment key={t.id}>
          <tr id={"tdoc-sd:"+t.id} style={{background:overdue?"var(--red-soft,#fbe6e8)":"#fff"}}>
            <td style={{textAlign:"center"}}>
              <button onClick={function(){setOpenIds(Object.assign({},openIds,{[t.id]:!open}));}}
                title={nums.length+" drawing number(s)"}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--ink-3,#6f6b62)",fontFamily:"var(--font-mono)"}}>
                {open?"▾":"▸"}{nums.length||""}</button>
            </td>
            <td><input type="text" value={t.ref||""} onChange={function(e){updT(i,{ref:e.target.value});}}
              placeholder="TR-001" style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/></td>
            <td><input type="text" value={t.description||""} onChange={function(e){updT(i,{description:e.target.value});}}
              placeholder="e.g. Level 3 ceiling layouts" style={{fontSize:11,padding:"4px 6px"}}/></td>
            <td style={{textAlign:"center"}}><input type="date" min="1990-01-01" max="2200-12-31" value={t.target||""}
              onChange={function(e){updT(i,{target:e.target.value});}} style={{fontSize:11,padding:"3px 5px"}}/></td>
            <td>{docCell("sd:"+t.id)}</td>
            <td style={{textAlign:"center"}}>
              <button onClick={function(){delT(i);}} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13}}>🗑</button>
            </td>
          </tr>

          {revRow("sd:"+t.id,6)}
          {open&&<tr><td></td><td colSpan={5} style={{background:"#faf9f7",padding:"8px 10px"}}>
            <div style={{fontSize:10,fontWeight:700,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>
              Drawings in this transmission</div>
            {nums.length===0&&<div style={{fontSize:11,color:"var(--ink-4,#9b968b)",marginBottom:6}}>No drawing number yet.</div>}
            {nums.map(function(n,k){
              return <div key={n.id||k} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}>
                <input type="text" value={n.number||""} placeholder="SD number"
                  onChange={function(e){updT(i,{numbers:nums.map(function(x,z){return z!==k?x:Object.assign({},x,{number:e.target.value});})});}}
                  style={{width:150,fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/>
                <input type="text" value={n.description||""} placeholder="what this drawing shows"
                  onChange={function(e){updT(i,{numbers:nums.map(function(x,z){return z!==k?x:Object.assign({},x,{description:e.target.value});})});}}
                  style={{flex:1,minWidth:120,fontSize:11,padding:"4px 6px"}}/>
                <button onClick={function(){updT(i,{numbers:nums.filter(function(_,z){return z!==k;})});}}
                  style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:12}}>×</button>
              </div>;
            })}
            <button className="btn btn-sm" onClick={function(){addNum(i);}} style={{padding:"3px 9px",fontSize:11}}>＋ Drawing number</button>
          </td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>}
  </div>;
}

// ---------------------------------------------------------------------------
// Material documents (MAR / MSS) — ONE reading for every view.
//
// A material's MAR and MSS are submission documents like the ACC, WMS or ITP: their state
// lives in mat.cycles.mar|mss (R0, R1… with codes A/B/C/D), read by cyclesOfMat and written
// by matWithCycles. The Materials table, the Materials tab and Flow & history → Submissions
// all go through matDoc() below, so they can no longer disagree.
// The only thing typed by hand before the submission is "under preparation" (mat.marStatus).
// ---------------------------------------------------------------------------
// MAR theoretical submission: contract signed + marAfterContract (Settings › Durations).
// While the contract is unsigned, falls back to the theoretical signing date.
function matDocTheo(td){
  var ct=((td&&td.stepDates)||{}).contract||{};
  var signed=ct.signedAllDone||ct.signedDone||ct.done||"";
  if(isValidDate(signed))return{date:addCalDays(signed,getDur("marAfterContract")),base:signed,firm:true};
  var chain=(function(){try{return theoreticalDates(td);}catch(e){return{};}})();
  var est=(chain.contract||{}).effective||(chain.contract||{}).theoretical||"";
  if(isValidDate(est))return{date:addCalDays(est,getDur("marAfterContract")),base:est,firm:false};
  return{date:"",base:"",firm:false};
}
// Which documents a material has: the MAR always, the MSS when ticked — or when it already
// has a history, so nothing recorded ever disappears from view.
function matDocKinds(m){
  return m&&(m.hasMSS||cyclesOfMat(m,"mss").length)?["mss","mar"]:["mar"];
}
function matDocRef(m,k){return String((m||{})[k+"Ref"]||(m||{})[k+"Number"]||"").trim();}
function matDocId(m,i,k){return k+":"+((m&&m.id)||i);}
function matDoc(td,m,i,kd,marSub){
  if(marSub===undefined)marSub=matDocTheo(td).date;
  return {id:matDocId(m,i,kd),group:"Materials",kind:kd,label:kd.toUpperCase(),sub:m.name||("material "+(i+1)),ref:matDocRef(m,kd),
    cycles:cyclesOfMat(m,kd),theoSub:marSub,
    theoApproval:isValidDate(marSub)?addCalDays(marSub,getDur("clientResponse")):"",
    patchFor:function(list){
      return {materials:(td.materials||[]).map(function(x,j){return (x.id?x.id===m.id:j===i)?matWithCycles(x,kd,list):x;})};
    }};
}
// Status cell: before the submission, the only choice is "under preparation"; after it,
// the state comes from the revisions and is read-only.
function MatDocStatus({doc,prep,onPrep}){
  var s=docSummary(doc);var l=doc.cycles;var last=l[l.length-1];
  if(s.state==="none"){
    if(!onPrep)return <span style={{fontSize:11,color:prep?"#1a73e8":"#9b968b",fontWeight:prep?700:400}}>{prep?"Under preparation":"Not submitted"}</span>;
    return <select value={prep?"under preparation":""} onChange={function(e){onPrep(e.target.value);}}
      style={{fontSize:11,padding:"3px 6px",fontWeight:700,fontFamily:"inherit",color:prep?"#1a73e8":"#9b968b",width:"100%"}}>
      <option value="">— Not submitted</option>
      <option value="under preparation">Under preparation</option>
    </select>;
  }
  var lab={pending:"With client"+(last&&last.rev?" · R"+last.rev:""),returned:"To resubmit"+(last&&last.rev?" · R"+last.rev:""),approved:"Approved"+(last&&last.rev?" · R"+last.rev:"")}[s.state];
  var col={pending:"#1a73e8",returned:"#b35c00",approved:"#1e6b3a"}[s.state];
  return <span title="Edit the revisions with the ▸ arrow on this row" style={{fontSize:11,fontWeight:700,color:col,whiteSpace:"nowrap"}}>{lab}</span>;
}
// Approval cell: the client's code and its date, or when the answer is expected.
function MatDocApproval({doc}){
  var l=doc.cycles,last=l[l.length-1];
  if(!last||(!last.submitted&&!last.code))return <span style={{color:"#ccc",fontSize:11}}>—</span>;
  if(last.code){
    var k=FLOW_CODE_COL[last.code]||["#f5f3ee","#6f6b62"];var info=cycleCodeInfo(last.code)||{};
    return <span title={(info.label||"")+(last.comment?" — "+last.comment:"")} style={{display:"inline-flex",gap:5,alignItems:"center",fontSize:11,whiteSpace:"nowrap"}}>
      <span style={{background:k[0],color:k[1],border:"1px solid "+k[1],borderRadius:3,fontSize:10,fontWeight:700,padding:"0 4px"}}>{last.code}</span>
      {last.returned?fmtDate(last.returned):<i style={{color:"#b35c00"}} title="Code recorded without a date: open ▸ and fill in the returned date">no date</i>}
    </span>;
  }
  var due=addCalDays(last.submitted,getDur("clientResponse"));
  var late=isValidDate(due)&&due<today();
  return <span title={"Submitted "+fmtDate(last.submitted)+" + "+getDur("clientResponse")+" days client response"}
    style={{fontSize:11,whiteSpace:"nowrap",color:late?"#c62828":"#1a73e8",fontWeight:late?700:500}}>{late?"⚠ due ":"expected "}{fmtDate(due)}</span>;
}

// Before the submission only: "under preparation" opens the "Prepare the MAR: name — title"
// action, back to "—" closes it. Shared by the tender's Materials table and the Materials view.
function matPrepTasks(td,mat,kind,newStatus,tasks,owner){
  var qtag=qualityTag(td.package||"");
  var prepText="Prepare the "+kind+": "+(mat.name||"material")+" — "+td.title;
  var updated=(tasks||[]).map(function(t){
    if(t.tenderRef===td.id&&t.text===prepText&&t.status!=="done"&&newStatus!=="under preparation")
      return Object.assign({},t,{status:"done",completedAt:today()});
    return t;
  });
  if(newStatus==="under preparation"){
    var exists=updated.some(function(t){return t.tenderRef===td.id&&t.text===prepText&&t.status!=="done";});
    if(!exists)updated=[newTask({text:prepText,owner:owner||"",due:mat[kind.toLowerCase()+"Target"]||"",tenderRef:td.id,package:td.package||"",
      importance:2,urgence:2,tags:[qtag],note:"Auto — "+kind+" under preparation",addedBy:"System"}),...updated];
  }
  return updated;
}
// ---------------------------------------------------------------------------
// Purchases — specific materials bought directly from a supplier, without a subcontract.
//
// A tender can carry its subcontract AND one or several purchases (td.purchases):
//   {id, title, materialIds:[mat.id…], quotes:[{id,supplier,amount,note}], chosen:quoteId,
//    amount (typed when no quote is retained), need:{acc,aconex}: "auto"|"yes"|"no",
//    accTarget, aconexTarget, accRef, aconexRef, cycles:{acc:[…],aconex:[…]},
//    poNumber, poDate, deliveryTarget, deliveryDone, note}
// Several suppliers can be consulted for the same purchase (quotes); one is retained.
// "auto": the ACC is required from Settings › Durations › purchaseAccMin, the Aconex from
// purchaseAconexMin, compared to the retained amount. "yes" / "no" overrides.
// Both are documents of tenderDocs (kinds pacc / paconex): revisions, overdue, automatic
// actions, Flow & history. The MAR stays on the material (td.materials), whoever supplies it.
// ---------------------------------------------------------------------------
const PURCHASE_DOCS=[{k:"acc",kind:"pacc",label:"ACC",min:"purchaseAccMin"},{k:"aconex",kind:"paconex",label:"Aconex",min:"purchaseAconexMin"}];
function newPurchase(o){return Object.assign({id:uuid(),title:"",materialIds:[],quotes:[],chosen:"",amount:"",need:{acc:"auto",aconex:"auto"},
  accTarget:"",aconexTarget:"",accRef:"",aconexRef:"",cycles:{acc:[],aconex:[]},poNumber:"",poDate:"",deliveryTarget:"",deliveryDone:"",note:""},o||{});}
function newPurchaseQuote(o){return Object.assign({id:uuid(),supplier:"",amount:"",note:""},o||{});}
function purchaseQuote(p){return ((p&&p.quotes)||[]).find(function(q){return q.id===p.chosen;})||null;}
function purchaseAmount(p){var q=purchaseQuote(p);var v=momNum(q?q.amount:(p||{}).amount);return isNaN(v)?null:v;}
function purchaseSupplier(p){var q=purchaseQuote(p);return q?String(q.supplier||"").trim():"";}
function purchaseName(p,i){return String((p&&p.title)||"").trim()||purchaseSupplier(p)||("Purchase "+((i>=0?i:0)+1));}
function cyclesOfPurchase(p,k){return _readCycles(((p&&p.cycles)||{})[k],null,null);}
// Whether a purchase needs the ACC / the Aconex, and why: {need, why}.
function purchaseNeedInfo(p,k){
  var x=PURCHASE_DOCS.find(function(d){return d.k===k;});
  var mode=((p&&p.need)||{})[k]||"auto";
  if(mode==="yes")return{need:true,why:"Required (set by hand)"};
  if(mode==="no")return{need:false,why:"Not required (set by hand)"};
  var min=getDur(x.min),amt=purchaseAmount(p);
  if(min<=0)return{need:true,why:"Required for every purchase (threshold 0 in Settings › Durations)"};
  if(amt===null)return{need:false,why:"Amount unknown — required from "+momEur(min)};
  return amt>=min?{need:true,why:momEur(amt)+" ≥ threshold "+momEur(min)}:{need:false,why:momEur(amt)+" < threshold "+momEur(min)};
}
// A document that already went to the client stays listed whatever the amount says.
function purchaseNeeds(p,k){return purchaseNeedInfo(p,k).need||cyclesOfPurchase(p,k).length>0;}
function purchaseDoc(td,p,k){
  var x=PURCHASE_DOCS.find(function(d){return d.k===k;});
  var sub=p[k+"Target"]||"";
  return {id:x.kind+":"+p.id,group:"Purchases",kind:x.kind,label:x.label,sub:purchaseName(p,(td.purchases||[]).indexOf(p)),
    ref:String(p[k+"Ref"]||"").trim(),cycles:cyclesOfPurchase(p,k),theoSub:sub,
    theoApproval:isValidDate(sub)?addWorkingDays(sub,getDur("accApproval")):"",
    patchFor:function(list){
      return {purchases:(td.purchases||[]).map(function(y){
        if(y.id!==p.id)return y;
        var c=Object.assign({},y.cycles||{});c[k]=_cyClean(list);
        return Object.assign({},y,{cycles:c});
      })};
    }};
}
function PurchasesPanel({td,updTd,afterSave,focus}){
  const [openRow,setOpenRow]=useState({});
  const [fold,setFold]=useState({});
  function toggleRow(id){setOpenRow(function(o){var n=Object.assign({},o);n[id]=!o[id];return n;});}
  useEffect(function(){
    if(!focus||!/^(pacc|paconex):/.test(focus.id))return;
    var pid=focus.id.replace(/^[a-z]+:/,"");
    setFold(function(o){var n=Object.assign({},o);n[pid]=false;return n;});
    setOpenRow(function(o){var n=Object.assign({},o);n[focus.id]=true;return n;});
    scrollToDoc(focus.id);
  },[focus&&focus.n]);
  var list=td.purchases||[];
  var mats=td.materials||[];
  var ro=isReadOnly();

  function save(ps){if(blockIfReadOnly())return;updTd("purchases",ps);}
  function updP(id,patch){save(list.map(function(p){return p.id===id?Object.assign({},p,patch):p;}));}
  function updQ(p,qid,patch){updP(p.id,{quotes:(p.quotes||[]).map(function(q){return q.id===qid?Object.assign({},q,patch):q;})});}
  function setNeed(p,k,v){var n=Object.assign({acc:"auto",aconex:"auto"},p.need||{});n[k]=v;updP(p.id,{need:n});}
  function toggleMat(p,mid){
    var ids=(p.materialIds||[]).slice();var i=ids.indexOf(mid);
    if(i>=0)ids.splice(i,1);else ids.push(mid);
    updP(p.id,{materialIds:ids});
  }
  function del(p,i){
    if(!mayDelete()&&!isAppAdmin((window._currentUser||{}).name)){safeAlert("Deleting is not allowed for your account.");return;}
    if(!safeConfirm("Remove \""+purchaseName(p,i)+"\" and its ACC / Aconex history?"))return;
    save(list.filter(function(x){return x.id!==p.id;}));
  }
  function approval(doc){
    var l=doc.cycles,last=l[l.length-1];
    if(!last||(!last.submitted&&!last.code))return <span style={{color:"#ccc",fontSize:11}}>—</span>;
    if(last.code){
      var k=FLOW_CODE_COL[last.code]||["#f5f3ee","#6f6b62"];
      return <span title={((cycleCodeInfo(last.code)||{}).label||"")+(last.comment?" — "+last.comment:"")} style={{display:"inline-flex",gap:5,alignItems:"center",fontSize:11,whiteSpace:"nowrap"}}>
        <span style={{background:k[0],color:k[1],border:"1px solid "+k[1],borderRadius:3,fontSize:10,fontWeight:700,padding:"0 4px"}}>{last.code}</span>
        {last.returned?fmtDate(last.returned):""}</span>;
    }
    var ov=docOverdue(doc,last.submitted);
    return <span style={{fontSize:11,whiteSpace:"nowrap",color:ov?"#c62828":"#1a73e8",fontWeight:ov?700:500}}>
      {ov?"⚠ due ":"expected "}{fmtDate(docResponseDue(doc,last.submitted))}</span>;
  }
  var inp={fontSize:11,padding:"3px 6px"};
  var lbl={fontSize:10,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"};

  return <div style={{marginBottom:10}}>
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"6px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Purchases</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
        Specific materials bought directly · ACC from {momEur(getDur("purchaseAccMin"))||"€ 0"}, Aconex from {momEur(getDur("purchaseAconexMin"))||"€ 0"} (Settings › Durations){list.length?" · "+list.length+" purchase"+(list.length>1?"s":""):""}</span>
      {!ro&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){save(list.concat([newPurchase()]));}}>＋ Purchase</button>}
    </div>
    {list.length===0&&<div style={{color:"var(--ink-4,#9b968b)",fontSize:12,padding:"6px 0"}}>No purchase on this package. Use ＋ Purchase for materials bought without a subcontract.</div>}
    {list.map(function(p,i){
      var folded=!!fold[p.id];
      var amt=purchaseAmount(p),sup=purchaseSupplier(p);
      var docs=PURCHASE_DOCS.map(function(x){return {x:x,info:purchaseNeedInfo(p,x.k),doc:purchaseDoc(td,p,x.k),listed:purchaseNeeds(p,x.k)};});
      var matNames=mats.filter(function(m){return (p.materialIds||[]).indexOf(m.id)>=0;}).map(function(m){return m.name||"material";});
      return <div key={p.id} style={{border:"1px solid var(--rule,#ddd9cf)",borderRadius:8,marginBottom:8,background:"#fff"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",flexWrap:"wrap",borderBottom:folded?"none":"1px solid #f0ede6"}}>
          <button type="button" onClick={function(){var n=Object.assign({},fold);n[p.id]=!folded;setFold(n);}}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"#8b8578",padding:0}}>{folded?"▸":"▾"}</button>
          <input type="text" value={p.title||""} placeholder={"Purchase "+(i+1)+" — what is bought…"} disabled={ro}
            onChange={function(e){updP(p.id,{title:e.target.value});}}
            style={{fontSize:13,fontWeight:700,border:"none",background:"transparent",padding:"2px 0",flex:"1 1 200px",minWidth:160}}/>
          {sup&&<span className="badge" style={{background:"var(--blue-soft,#e8f0fe)",color:"var(--blue,#0f5299)"}}>{sup}</span>}
          {amt!==null&&<span style={{fontSize:12,fontWeight:700,fontFamily:"var(--font-mono)"}}>{momEur(amt)}</span>}
          {docs.filter(function(d){return d.listed;}).map(function(d){
            var st=docSummary(d.doc).state;
            var col={approved:"#1e6b3a",pending:"#1a73e8",returned:"#b35c00",none:"#9b968b"}[st];
            return <span key={d.x.k} title={d.info.why} style={{fontSize:10,fontWeight:700,color:col,border:"1px solid "+col,borderRadius:9,padding:"0 7px"}}>
              {d.x.label} · {{approved:"approved",pending:"with client",returned:"to resubmit",none:"to submit"}[st]}</span>;
          })}
          {p.deliveryDone&&<span style={{fontSize:10,fontWeight:700,color:"#1e6b3a"}}>✓ delivered {fmtDate(p.deliveryDone)}</span>}
          {!ro&&<button onClick={function(){del(p,i);}} title="Remove this purchase" style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13}}>🗑</button>}
        </div>
        {!folded&&<div style={{padding:"8px 12px 10px"}}>
          {/* Suppliers consulted: one is retained, its amount drives the ACC / Aconex thresholds. */}
          <div style={Object.assign({},lbl,{marginBottom:4})}>Suppliers consulted</div>
          {(p.quotes||[]).length>0&&<table className="tbl" style={{fontSize:12,marginBottom:6}}>
            <thead><tr><th style={{width:70,textAlign:"center"}}>Retained</th><th>Supplier</th><th style={{width:130}}>Amount €</th><th>Note</th><th style={{width:34}}></th></tr></thead>
            <tbody>{(p.quotes||[]).map(function(q){
              var on=p.chosen===q.id;
              return <tr key={q.id} style={{background:on?"#f1f8f2":"#fff"}}>
                <td style={{textAlign:"center"}}><input type="radio" checked={on} disabled={ro} onChange={function(){updP(p.id,{chosen:q.id});}}
                  onClick={function(){if(on)updP(p.id,{chosen:""});}} title={on?"Click again to un-retain":"Retain this supplier"} style={{width:14,height:14,cursor:"pointer"}}/></td>
                <td><input type="text" value={q.supplier||""} placeholder="Supplier…" disabled={ro} onChange={function(e){updQ(p,q.id,{supplier:e.target.value});}}
                  style={Object.assign({},inp,{width:"100%",fontWeight:on?700:400})}/></td>
                <td><input type="text" inputMode="decimal" value={q.amount||""} placeholder="0" disabled={ro} onChange={function(e){updQ(p,q.id,{amount:e.target.value});}}
                  style={Object.assign({},inp,{width:"100%",textAlign:"right",fontFamily:"var(--font-mono)"})}/></td>
                <td><input type="text" value={q.note||""} placeholder="lead time, conditions…" disabled={ro} onChange={function(e){updQ(p,q.id,{note:e.target.value});}}
                  style={Object.assign({},inp,{width:"100%"})}/></td>
                <td style={{textAlign:"center"}}>{!ro&&<button onClick={function(){
                    updP(p.id,{quotes:(p.quotes||[]).filter(function(x){return x.id!==q.id;}),chosen:on?"":p.chosen});
                  }} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:12}}>✕</button>}</td>
              </tr>;
            })}</tbody>
          </table>}
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
            {!ro&&<button className="btn btn-sm" onClick={function(){updP(p.id,{quotes:(p.quotes||[]).concat([newPurchaseQuote()])});}}>＋ Supplier</button>}
            {!purchaseQuote(p)&&<span style={{display:"flex",gap:5,alignItems:"center"}}><span style={lbl}>Amount €</span>
              <input type="text" inputMode="decimal" value={p.amount||""} placeholder="no supplier retained" disabled={ro}
                onChange={function(e){updP(p.id,{amount:e.target.value});}} style={Object.assign({},inp,{width:150,textAlign:"right",fontFamily:"var(--font-mono)"})}/></span>}
          </div>

          {/* Materials of the package bought here; their MAR is followed in Materials above. */}
          <div style={Object.assign({},lbl,{marginBottom:4})}>Materials</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
            {mats.length===0&&<span style={{fontSize:11,color:"#9b968b"}}>Add the material in Materials above: its MAR is followed there.</span>}
            {mats.map(function(m,mi){
              var on=(p.materialIds||[]).indexOf(m.id)>=0;
              if(!m.id)return null;
              return <button key={m.id} type="button" disabled={ro} onClick={function(){toggleMat(p,m.id);}}
                style={{fontSize:11,padding:"2px 9px",borderRadius:11,cursor:ro?"default":"pointer",fontFamily:"inherit",
                  border:"1px solid "+(on?"var(--gold-ink,#8a6a1e)":"var(--rule,#ddd9cf)"),background:on?"var(--gold-soft,#faf3e0)":"#fff",
                  color:on?"var(--gold-ink,#8a6a1e)":"#9b968b",fontWeight:on?700:400}}>{on?"✓ ":""}{m.name||("material "+(mi+1))}</button>;
            })}
          </div>

          {/* Client approval: ACC and Aconex, each required from its own amount. */}
          <div style={Object.assign({},lbl,{marginBottom:4})}>Client approval</div>
          <table className="tbl" style={{fontSize:12,marginBottom:10}}>
            <thead><tr>
              <th style={{width:80}}>Doc</th><th style={{minWidth:150}}>Required</th><th style={{textAlign:"center",minWidth:112}}>Target</th>
              <th style={{minWidth:100}}>Status</th><th style={{textAlign:"center",minWidth:100}}>Submitted</th><th style={{minWidth:110}}>Approval</th><th style={{minWidth:104}}>Reference</th>
            </tr></thead>
            <tbody>{docs.map(function(d){
              var doc=d.doc,sum=docSummary(doc),last=doc.cycles[doc.cycles.length-1],isOpen=!!openRow[doc.id];
              var mode=((p.need||{})[d.x.k])||"auto";
              var auto=purchaseNeedInfo(Object.assign({},p,{need:{}}),d.x.k);
              var tgt=p[d.x.k+"Target"]||"";
              var late=d.listed&&tgt&&tgt<today()&&sum.state==="none";
              return <React.Fragment key={d.x.k}>
                <tr id={"tdoc-"+doc.id} style={{opacity:d.listed?1:.55}}>
                  <td style={{whiteSpace:"nowrap"}}>
                    {d.listed&&<button type="button" onClick={function(){toggleRow(doc.id);}} title="Show or edit the revisions"
                      style={{background:"none",border:"none",cursor:"pointer",padding:"0 4px 0 0",fontSize:11,color:"#8b8578",fontFamily:"inherit"}}>{isOpen?"▾":"▸"}</button>}
                    <span className="badge" style={{background:"var(--blue-soft,#e8f0fe)",color:"var(--blue,#0f5299)"}}>{d.x.label}</span>
                  </td>
                  <td>
                    <select value={mode} disabled={ro} onChange={function(e){setNeed(p,d.x.k,e.target.value);}} style={Object.assign({},inp,{fontWeight:600})}>
                      <option value="auto">Auto ({auto.need?"required":"not required"})</option>
                      <option value="yes">Required</option>
                      <option value="no">Not required</option>
                    </select>
                    <div style={{fontSize:10,color:"#9b968b",marginTop:2}}>{auto.why}</div>
                  </td>
                  <td style={{textAlign:"center"}}>{d.listed&&<input type="date" min="1990-01-01" max="2200-12-31" value={tgt} disabled={ro}
                    onChange={function(e){var u={};u[d.x.k+"Target"]=e.target.value;updP(p.id,u);}}
                    style={Object.assign({},inp,{border:"1.5px solid "+(late?"#f0cdc9":"var(--rule,#ddd9cf)"),borderRadius:5,background:late?"#fbe6e8":"#fff"})}/>}</td>
                  <td>{d.listed?<MatDocStatus doc={doc}/>:<span style={{fontSize:11,color:"#9b968b"}}>Not required</span>}</td>
                  <td style={{textAlign:"center"}}>
                    {!d.listed?null:last&&last.submitted
                      ?<span style={{fontSize:11,whiteSpace:"nowrap"}}>{fmtDate(last.submitted)}
                        {last.rev>0&&<span style={{fontSize:9.5,color:"#b35c00",fontWeight:700,marginLeft:4}}>R{last.rev}</span>}</span>
                      :sum.state==="none"&&!ro
                        ?<button type="button" className="btn btn-sm" style={{fontSize:10,padding:"1px 7px"}} onClick={function(){
                            recordDocSubmission(td,doc,updTd,afterSave).then(function(r){if(r)setOpenRow(function(o){var n=Object.assign({},o);n[doc.id]=true;return n;});});
                          }}>＋ Record</button>
                        :<span style={{color:"#ccc",fontSize:11}}>—</span>}
                  </td>
                  <td>{d.listed&&approval(doc)}</td>
                  <td>{d.listed&&<input type="text" value={p[d.x.k+"Ref"]||""} placeholder="Ref…" disabled={ro} title="Transmittal or Aconex number"
                    onChange={function(e){var u={};u[d.x.k+"Ref"]=e.target.value;updP(p.id,u);}}
                    style={Object.assign({},inp,{fontFamily:"var(--font-mono)"})}/>}</td>
                </tr>
                {d.listed&&isOpen&&<tr><td colSpan={7} style={{background:"#faf9f6",padding:"6px 12px 10px 24px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#6f6b62",marginBottom:2}}>{d.x.label} — {purchaseName(p,i)}</div>
                  <DocRevisionsEditor td={td} d={doc} updTd={updTd} afterSave={afterSave}/>
                </td></tr>}
              </React.Fragment>;
            })}</tbody>
          </table>

          {/* Order and delivery */}
          <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{display:"flex",gap:5,alignItems:"center"}}><span style={lbl}>PO n°</span>
              <input type="text" value={p.poNumber||""} disabled={ro} onChange={function(e){updP(p.id,{poNumber:e.target.value});}} style={Object.assign({},inp,{width:120,fontFamily:"var(--font-mono)"})}/></span>
            <span style={{display:"flex",gap:5,alignItems:"center"}}><span style={lbl}>PO date</span>
              <input type="date" min="1990-01-01" max="2200-12-31" value={p.poDate||""} disabled={ro} onChange={function(e){updP(p.id,{poDate:e.target.value});}} style={inp}/></span>
            <span style={{display:"flex",gap:5,alignItems:"center"}}><span style={lbl}>Delivery target</span>
              <input type="date" min="1990-01-01" max="2200-12-31" value={p.deliveryTarget||""} disabled={ro} onChange={function(e){updP(p.id,{deliveryTarget:e.target.value});}}
                style={Object.assign({},inp,p.deliveryTarget&&!p.deliveryDone&&p.deliveryTarget<today()?{background:"#fbe6e8",border:"1.5px solid #f0cdc9"}:{})}/></span>
            <span style={{display:"flex",gap:5,alignItems:"center"}}><span style={lbl}>Delivered</span>
              <input type="date" min="1990-01-01" max="2200-12-31" value={p.deliveryDone||""} disabled={ro} onChange={function(e){updP(p.id,{deliveryDone:e.target.value});}} style={inp}/></span>
            <input type="text" value={p.note||""} placeholder="Note…" disabled={ro} onChange={function(e){updP(p.id,{note:e.target.value});}}
              style={Object.assign({},inp,{flex:"1 1 200px"})}/>
          </div>
          {matNames.length>0&&<div style={{fontSize:10.5,color:"#9b968b",marginTop:6}}>MAR followed on: {matNames.join(", ")}</div>}
        </div>}
      </div>;
    })}
  </div>;
}
function MaterialsPanel({td,updTd,saveT,tasks,tenders,saveTenders,setSelTender,pkgOwners,afterSave,focus}){
  const [open,setOpen]=useState(false);
  const [openRow,setOpenRow]=useState({});
  function toggleRow(id){setOpenRow(function(o){var n=Object.assign({},o);n[id]=!o[id];return n;});}
  useEffect(function(){
    if(!focus||!/^(mar|mss):/.test(focus.id))return;
    setOpenRow(function(o){var n=Object.assign({},o);n[focus.id]=true;return n;});
    scrollToDoc(focus.id);
  },[focus&&focus.n]);
  var mats=td.materials||[];

  function pkgOwner(){return (pkgOwners||{})[td.package||""]||td.ownerTender||"";}

  // Before the submission only: "under preparation" opens the "Prepare the …" action, back to
  // "—" closes it. Everything after the submission is handled by afterSave (flowTaskChanges),
  // whose "Prepare the MAR: name — title" text is the same, so it closes this one.
  function stepAction(mat,kind,newStatus){
    if(!saveT||!tasks)return;
    saveT(matPrepTasks(td,mat,kind,newStatus,tasks,pkgOwner()));
  }

  function updMat(mi,field,val){
    var ms=mats.map(function(m,j){return j!==mi?m:Object.assign({},m,{[field]:val});});
    updTd("materials",ms);
  }
  var matTheo=matDocTheo(td);
  function setPrep(mi,mat,kind,val){
    updMat(mi,kind.toLowerCase()+"Status",val);
    var u={};u[kind.toLowerCase()+"Status"]=val;
    stepAction(Object.assign({},mat,u),kind,val);
  }
  // First submission: R0 sent today, through the same writer as Flow & history.
  function recordSub(mat,mi,k){
    var d=matDoc(td,mat,mi,k,matTheo.date);
    recordDocSubmission(td,d,updTd,afterSave).then(function(p){
      if(p)setOpenRow(function(o){var n=Object.assign({},o);n[d.id]=true;return n;});
    });
  }

  var COLS=11;
  return <div style={{marginBottom:10}}>
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Materials</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
        MAR is due after the contract is signed · ▸ opens the revisions (R0, R1…, codes A/B/C/D){mats.length>0?" · "+mats.length+" material"+(mats.length!==1?"s":""):""}</span>
      <button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(e){e.stopPropagation();
        var ms=[...mats,{id:uuid(),name:"",specified:"",proposed:"",leadTime:"",
          mssStatus:"",mssTarget:"",mssDone:"",mssApprovalStatus:"",mssApprovalTarget:"",mssApprovalDone:"",mssReview:"",mssLink:"",mssLinkLabel:"",mssNumber:"",
          marStatus:"",marTarget:"",marDone:"",marApprovalStatus:"",marApprovalTarget:"",marApprovalDone:"",marReview:"",marLink:"",marLinkLabel:"",marNumber:"",
          hasPO:false,poNumber:"",poStatus:""}];
        updTd("materials",ms);setOpen(true);
      }}>＋ Material</button>
    </div>

    <div>
      {mats.length===0&&<div style={{color:"var(--ink-4,#9b968b)",fontSize:12,padding:"6px 0"}}>No material yet. Use ＋ Material to add one.</div>}
      {mats.length>0&&<table className="tbl" style={{fontSize:12}}>
        <thead><tr>
          <th style={{minWidth:190}}>Material</th>
          <th style={{width:50,textAlign:"center"}} title="Tick when this material needs a Material Submission Sheet. Most do not.">MSS</th>
          <th style={{width:70}}>Doc</th>
          <th style={{textAlign:"center",minWidth:96}} title="Contract signed + the MAR lead time set in Settings › Durations. Falls back to the theoretical signing date while the contract is unsigned.">Theoretical</th>
          <th style={{textAlign:"center",minWidth:112}}>Target</th>
          <th style={{minWidth:130}}>Status</th>
          <th style={{textAlign:"center",minWidth:100}} title="Date the latest revision was sent to the client">Submitted</th>
          <th style={{minWidth:110}} title="Client code (A/B/C/D) and date of return — or when the answer is expected">Approval</th>
          <th style={{minWidth:104}}>Reference</th>
          <th style={{width:88}}>Lead time</th>
          <th style={{width:34}}></th>
        </tr></thead>
        <tbody>{mats.map(function(mat,mi){
          var kinds=matDocKinds(mat);
          var docs=kinds.map(function(p){return matDoc(td,mat,mi,p,matTheo.date);});
          // Editor rows go after the material's rows, so the rowSpan cells stay intact.
          return <React.Fragment key={mat.id||mi}>
            {kinds.map(function(p,di){
              var kind=p.toUpperCase();
              var doc=docs[di];
              var sum=docSummary(doc);
              var last=doc.cycles[doc.cycles.length-1];
              var due=mat[p+"Target"]||"";
              var late=due&&due<today()&&sum.state==="none";
              var isOpen=!!openRow[doc.id];
              return <tr key={kind} id={"tdoc-"+doc.id} style={{background:di>0?"#fafaf8":"#fff"}}>
                {di===0&&<td rowSpan={kinds.length} style={{verticalAlign:"top"}}>
                  <input type="text" value={mat.name||""} onChange={function(e){updMat(mi,"name",e.target.value);}}
                    placeholder="Material name…" style={{fontSize:12,fontWeight:600,border:"none",background:"transparent",padding:"2px 0",width:"100%"}}/>
                  <div style={{display:"flex",gap:4,marginTop:3}}>
                    <input type="text" value={mat.specified||""} onChange={function(e){updMat(mi,"specified",e.target.value);}}
                      placeholder="specified" style={{fontSize:10,padding:"2px 5px"}}/>
                    <input type="text" value={mat.proposed||""} onChange={function(e){updMat(mi,"proposed",e.target.value);}}
                      placeholder="proposed" style={{fontSize:10,padding:"2px 5px"}}/>
                  </div>
                </td>}
                {di===0&&<td rowSpan={kinds.length} style={{textAlign:"center",verticalAlign:"top"}}>
                  <input type="checkbox" checked={!!mat.hasMSS} onChange={function(e){updMat(mi,"hasMSS",e.target.checked);}}
                    title={cyclesOfMat(mat,"mss").length&&!mat.hasMSS?"This MSS already has submissions, so it stays listed":"This material requires an MSS"} style={{width:14,height:14,cursor:"pointer"}}/>
                </td>}
                <td style={{whiteSpace:"nowrap"}}>
                  <button type="button" onClick={function(){toggleRow(doc.id);}} title="Show or edit the revisions"
                    style={{background:"none",border:"none",cursor:"pointer",padding:"0 4px 0 0",fontSize:11,color:"#8b8578",fontFamily:"inherit"}}>{isOpen?"▾":"▸"}</button>
                  <span className="badge" style={{background:kind==="MSS"?"var(--blue-soft,#e8f0fe)":"var(--gold-soft,#faf3e0)",
                    color:kind==="MSS"?"var(--blue,#0f5299)":"var(--gold-ink,#8a6a1e)"}}>{kind}</span>
                </td>
                <td style={{textAlign:"center"}}>
                  {matTheo.date
                    ?<span title={matTheo.firm?"Contract signed "+fmtDate(matTheo.base)+" + "+getDur("marAfterContract")+" days"
                                             :"Contract not signed yet — computed from the theoretical signing date "+fmtDate(matTheo.base)}
                      style={{fontSize:11,fontWeight:matTheo.firm?700:600,padding:"2px 7px",borderRadius:5,cursor:"help",
                        color:matTheo.firm?"var(--green,#1e6b3a)":"var(--ink-3,#6f6b62)",
                        background:matTheo.firm?"var(--green-soft,#e6f2e9)":"#f2f0eb",
                        border:"1px solid "+(matTheo.firm?"#c8e6c9":"var(--rule,#ddd9cf)")}}>{fmtDate(matTheo.date)}</span>
                    :<span style={{color:"#ddd",fontSize:11}} title="No contract date at all yet — fill the ACC step so the chain can compute one">—</span>}
                </td>
                <td style={{textAlign:"center"}}>
                  <input type="date" min="1990-01-01" max="2200-12-31" value={due} onChange={function(e){updMat(mi,p+"Target",e.target.value);}}
                    style={{fontSize:11,padding:"3px 5px",border:"1.5px solid "+(late?"#f0cdc9":"var(--rule,#ddd9cf)"),borderRadius:5,background:late?"#fbe6e8":"#fff"}}/>
                </td>
                <td>
                  <MatDocStatus doc={doc} prep={mat[p+"Status"]==="under preparation"} onPrep={function(v){setPrep(mi,mat,kind,v);}}/>
                </td>
                <td style={{textAlign:"center"}}>
                  {last&&last.submitted
                    ?<span style={{fontSize:11,whiteSpace:"nowrap"}}>{fmtDate(last.submitted)}
                      {last.rev>0&&<span style={{fontSize:9.5,color:"#b35c00",fontWeight:700,marginLeft:4}}>R{last.rev}</span>}</span>
                    :sum.state==="none"
                      ?<button type="button" className="btn btn-sm" onClick={function(){recordSub(mat,mi,p);}} style={{fontSize:10,padding:"1px 7px"}}>＋ Record</button>
                      :<span style={{color:"#ccc",fontSize:11}}>—</span>}
                </td>
                <td><MatDocApproval doc={doc}/></td>
                <td>
                  <input type="text" value={mat[p+"Ref"]||mat[p+"Number"]||""} onChange={function(e){updMat(mi,p+"Ref",e.target.value);}}
                    placeholder="Ref…" title="Transmittal or document number"
                    style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/>
                </td>
                {di===0&&<td rowSpan={kinds.length} style={{verticalAlign:"top"}}>
                  <input type="text" value={mat.leadTime||""} onChange={function(e){updMat(mi,"leadTime",e.target.value);}}
                    placeholder="e.g. 12 wks" style={{fontSize:11,padding:"3px 5px"}}/>
                </td>}
                {di===0&&<td rowSpan={kinds.length} style={{textAlign:"center",verticalAlign:"top"}}>
                  <button onClick={function(){
                      if(!safeConfirm("Remove \""+(mat.name||"this material")+"\"?"))return;
                      updTd("materials",mats.filter(function(_,j){return j!==mi;}));
                    }} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13}}>🗑</button>
                </td>}
              </tr>;
            })}
            {docs.filter(function(doc){return openRow[doc.id];}).map(function(doc){
              return <tr key={"ed-"+doc.id}><td colSpan={COLS} style={{background:"#faf9f6",padding:"6px 12px 10px 24px"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#6f6b62",marginBottom:2}}>{doc.label} — {mat.name||"material"}</div>
                <DocRevisionsEditor td={td} d={doc} updTd={updTd} afterSave={afterSave}/>
              </td></tr>;
            })}
          </React.Fragment>;
        })}</tbody>
      </table>}
    </div>
  </div>;
}


// part: "docs" = submission chain + WMS/ITP · "contract" = contract sub-steps only · omitted = both.
// focus: {id,n} from the tender's document register — opens that row and scrolls to it.
// Name of the client-approval step with its route: automatic from the amount, or forced.
function ApprovalRouteCell({td,updTd}){
  var r=tenderApprovalRoute(td);
  var ro=isReadOnly()||!updTd;
  var col={acc:"#1a73e8",aconex:"#7b1fa2",none:"#6f6b62"}[r.route]||"#555";
  return <span style={{display:"inline-flex",flexDirection:"column",gap:2,verticalAlign:"top"}}>
    <span style={{color:col}}>{tenderRouteLabel(td)}</span>
    <select value={td.approvalRoute||""} disabled={ro} title={r.why}
      onChange={function(e){if(blockIfReadOnly())return;updTd("approvalRoute",e.target.value);}}
      style={{fontSize:10,padding:"1px 4px",fontWeight:500,color:"#6f6b62",border:"1px solid #e8e6df",borderRadius:4,background:"#fff",maxWidth:170}}>
      <option value="">Auto{r.auto?" — "+APPROVAL_ROUTE_LABEL[r.auto]:" — amount unknown"}</option>
      <option value="acc">ACC (forced)</option>
      <option value="aconex">Aconex (forced)</option>
      <option value="none">Internal only (forced)</option>
    </select>
    <span style={{fontSize:9.5,fontWeight:400,color:r.manual?"#b35c00":"#9b968b",whiteSpace:"normal",maxWidth:190}}>
      {r.manual?"Forced · auto would be "+(APPROVAL_ROUTE_LABEL[r.auto]||"unknown"):r.why}</span>
    {r.route==="none"&&<span style={{fontSize:9.5,fontWeight:600,color:"#1e6b3a",whiteSpace:"normal",maxWidth:190}}>Not sent to the client — the contract starts once a bidder is awarded</span>}
  </span>;
}
function SubmissionSteps({td,TENDER_STEPS,updateStep,tenders,saveTenders,setSelTender,tasks,saveTasks,pkgOwners,updTd,afterSave,part,focus}){
  // Rows that can be opened: "bidders", "acc", "wms", "itp", "circuit". Hooks stay first.
  const [openRow,setOpenRow]=useState({});
  // Synthetic by default: once a document is with the client or approved, its row shrinks
  // to what matters (reference, dates, status). "Show all details" brings every field back.
  const [detail,setDetail]=useState(false);
  function toggleRow(k){setOpenRow(function(o){var n=Object.assign({},o);n[k]=!o[k];return n;});}
  useEffect(function(){
    if(!focus||["acc","wms","itp"].indexOf(focus.id)<0)return;
    setOpenRow(function(o){var n=Object.assign({},o);n[focus.id]=true;return n;});
    scrollToDoc(focus.id);
  },[focus&&focus.n]);
  // First submission of a document: R0 is sent today and its revisions open under the row.
  function recordSub(id){
    var d=flowDocOf(td,id);if(!d||!updTd)return;
    // The document reference is asked at the moment it is sent: that is when it is known.
    recordDocSubmission(td,d,updTd,afterSave).then(function(p){
      if(p)setOpenRow(function(o){var n=Object.assign({},o);n[id]=true;return n;});
    });
  }
  function chev(k){return <button type="button" onClick={function(e){e.stopPropagation();toggleRow(k);}} title="Show or hide the details" style={{background:"none",border:"none",cursor:"pointer",padding:"0 4px 0 0",fontSize:11,color:"#8b8578",fontFamily:"inherit"}}>{openRow[k]?"▾":"▸"}</button>;}
  function recordBtn(id){return flowDocState(td,id)==="none"&&updTd?<div><button type="button" className="btn btn-sm" onClick={function(){recordSub(id);}} style={{fontSize:10,padding:"1px 7px",marginTop:2}}>＋ Record submission</button></div>:null;}

  var HAS_APPROVAL=["acc","pkg","itp","wms"];

  function getDate(key,field){return((td.stepDates||{})[key]||{})[field]||"";}
  function getApprovalStatus(key){return((td.stepDates||{})[key]||{}).approvalStatus||"";}
  function getReference(key){return((td.stepDates||{})[key]||{}).reference||"";}

  function autoAction(text,tag,due){
    if(!saveTasks||!tasks)return;
    var exists=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status!=="done";});
    if(exists)return;
    var owner=(pkgOwners||{})[td.package||""]||td.ownerTender||"";
    var useTag=tag||"Contract";
    var useDue=due||"";
    saveTasks([newTask({text:text,owner:owner,tenderRef:td.id,package:td.package||"",tags:[useTag],status:"pending",due:useDue,note:"Auto-created from contract/SD status",addedBy:"System"}),...(tasks||[])]);
  }
  function closeAction(text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status!=="done";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===td.id&&t.text===text&&t.status!=="done")?Object.assign({},t,{status:"done",completedAt:today()}):t;}));
  }
  function removeAction(text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status!=="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).filter(function(t){return!(t.tenderRef===td.id&&t.text===text&&t.status!=="done"&&t.addedBy==="System");}));
  }
  function reopenAction(text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status==="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===td.id&&t.text===text&&t.status==="done"&&t.addedBy==="System")?Object.assign({},t,{status:"pending",completedAt:""}):t;}));
  }
  function linkCell(s){
    var key=s.key;
    return <div style={{marginTop:3}}>
      {((td.stepLinks||{})[key]||[]).map(function(lk,li){return <div key={li} style={{display:"flex",gap:3,marginBottom:2,alignItems:"center"}}>
        <input type="text" value={lk.label||""} onChange={function(e){var ls=((td.stepLinks||{})[key]||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{label:e.target.value});});updateStep(td.id,key,"links",ls);}} placeholder="Label" style={{width:70,padding:"2px 4px",fontSize:9,border:"1px solid #e0ddd8",borderRadius:4}}/>
        <input type="url" value={lk.url||""} onChange={function(e){var ls=((td.stepLinks||{})[key]||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{url:e.target.value});});updateStep(td.id,key,"links",ls);}} placeholder="https://..." style={{flex:1,padding:"2px 4px",fontSize:9,border:"1px solid #e0ddd8",borderRadius:4}}/>
        <button onClick={function(){var ls=((td.stepLinks||{})[key]||[]).filter(function(_,j){return j!==li;});updateStep(td.id,key,"links",ls);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:10,flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ccc";}}>✕</button>
      </div>;})}
      <button onClick={function(){var ls=[...((td.stepLinks||{})[key]||[]),{label:"",url:""}];updateStep(td.id,key,"links",ls);}} style={{fontSize:9,padding:"1px 5px",border:"1px solid #e0ddd8",borderRadius:4,background:"#fafal8",fontFamily:"inherit",cursor:"pointer",color:"#888"}}>＋ link</button>
      {((td.stepLinks||{})[key]||[]).filter(function(lk){return lk.url;}).map(function(lk,li){return <a key={li} href={lk.url} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:9,color:"#3949ab",textDecoration:"none",padding:"1px 5px",borderRadius:4,background:"#f0f0ff",border:"1px solid #d0d0f0",marginLeft:3}}>🔗 {lk.label||"link"}</a>;})}
    </div>;
  }

  // A submitted or approved document, in one line. A returned one (C/D) keeps the full
  // row: something has to be done on it.
  function isSynth(k){var st=flowDocState(td,k);return !detail&&(st==="pending"||st==="approved");}
  function synthRow(s,span){
    var k=s.key,d=flowDocOf(td,k),sm=docSummary(d),last=d.cycles[d.cycles.length-1]||{};
    var ref=getReference(k),ok=sm.state==="approved";
    var due=!ok&&last.submitted?docResponseDue(d,last.submitted):"";
    var lab={fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:".05em",marginRight:5};
    var proposed=Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0);
    return <React.Fragment key={k}><tr id={"tdoc-"+k} style={{background:ok?"#f2f9f3":"#f4f8ff"}}>
      <td style={{fontWeight:700,color:"#555",whiteSpace:"nowrap",padding:"8px 12px"}}>{chev(k)}{k==="acc"?<ApprovalRouteCell td={td} updTd={updTd}/>:s.label}</td>
      <td colSpan={span} style={{padding:"8px 12px"}}>
        <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap",fontSize:12}}>
          <span><span style={lab}>Doc no.</span>{ref
            ?<b style={{fontFamily:"var(--font-mono)",color:"#1a73e8"}}>{ref}</b>
            :<RefMissingInput onSave={function(v){updateStep(td.id,k,"reference",v);}}/>}</span>
          {ok
            ?<span><span style={lab}>Status</span><FlowDocBadge td={td} id={k}/></span>
            :<>
              <span><span style={lab}>Submitted</span><b>{fmtDate(last.submitted)}</b>{last.rev>0&&<span style={{fontSize:10,color:"#b35c00",fontWeight:700,marginLeft:4}}>R{last.rev}</span>}</span>
              <span title="Submission + the client's review time set in Settings › Durations"><span style={lab}>Theoretical return</span><b>{due?fmtDate(due):"—"}</b><OverdueTag o={sm.overdue}/></span>
            </>}
          {k==="acc"&&proposed>0&&<span><span style={lab}>Proposed</span><b>{proposed.toLocaleString()}</b> {td.currency||"EUR"}</span>}
        </div>
      </td>
    </tr>
    {openRow[k]&&<tr><td colSpan={span+1} style={{background:"#faf9f6",padding:"6px 12px 10px 24px"}}>
      <DocRevisionsEditor td={td} d={d} updTd={updTd} afterSave={afterSave}/>
    </td></tr>}
    </React.Fragment>;
  }
  var accSent=flowDocState(td,"acc")!=="none";

  // Steps excluding contract (rendered separately at bottom)
  var theoMap=theoreticalDates(td);
  // WMS and ITP are quality documents driven by the start on site, not by the tender
  // submission chain — they get their own panel.
  var QA_KEYS=["wms","itp"];
  var mainSteps=TENDER_STEPS.filter(function(s){return s.key!=="contract"&&s.key!=="kickoff"&&QA_KEYS.indexOf(s.key)<0;});
  // Once the ACC is submitted, the steps before it are history: hidden unless details are asked.
  var hiddenPrev=!detail&&accSent?mainSteps.filter(function(s){return s.key!=="acc";}).length:0;
  if(hiddenPrev)mainSteps=mainSteps.filter(function(s){return s.key==="acc";});
  var qaSteps=TENDER_STEPS.filter(function(s){return QA_KEYS.indexOf(s.key)>=0;});
  var contractStep=TENDER_STEPS.find(function(s){return s.key==="contract";});
  var kickoffStep=TENDER_STEPS.find(function(s){return s.key==="kickoff";});

  return <div>
    {/* Three sibling sections — Submission steps, WMS & ITP, Materials — all built the
        same way: a flat heading with a rule, then the table. None of them wraps another. */}
    {part!=="contract"&&<div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Submission steps</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>bidders → tender package → {tenderRouteLabel(td)}</span>
      {hiddenPrev>0&&<span style={{fontSize:11,color:"#9b968b"}}>· ACC submitted, {hiddenPrev} previous step{hiddenPrev>1?"s":""} hidden</span>}
      <button type="button" className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){setDetail(!detail);}}
        title={detail?"Back to the short view: documents submitted or approved on one line":"Every step and every field, including the ones already done"}>{detail?"▴ Synthetic view":"▾ Show all details"}</button>
    </div>}
    <div>
    {part!=="contract"&&<React.Fragment>
    <table className="tbl" style={{fontSize:12,marginBottom:16}}>
      {/* Column headers only mean something for full rows. */}
      {!mainSteps.every(function(s){return s.key==="acc"&&isSynth("acc");})&&<thead style={{position:"sticky",top:0,zIndex:10,background:"#f5f4f0"}}><tr>
        <th>Step</th>
        <th>Status</th>
        <th style={{textAlign:"center",minWidth:96}} title="Computed from the previous step. Turns solid once that step is done — it is no longer an estimate.">Theoretical</th>
        <th style={{textAlign:"center",minWidth:120}}>Submission target date</th>
        <th style={{textAlign:"center",minWidth:110}}>Date done</th>
        <th style={{minWidth:200}}>Date of approval / Status</th>
        <th style={{minWidth:150}}>Reference</th>
        <th style={{minWidth:180}}>Comments</th>
      </tr></thead>}
      <tbody>{mainSteps.map(function(s){
        if(s.key==="acc"&&isSynth("acc"))return synthRow(s,7);
        var val=(td.steps||{})[s.key]||"";
        var dates=(td.stepDates||{})[s.key]||{};
        var comment=(td.stepComments||{})[s.key]||"";
        var cls=tenderStepClass(s.key,val);
        var theo=(theoMap[s.key]||{});
        var showApproval=HAS_APPROVAL.indexOf(s.key)>=0;
        var showReference=s.key==="acc";
        var expandable=s.special==="bidders"||s.key==="acc";
        return <React.Fragment key={s.key}><tr id={"tdoc-"+s.key}>
          <td style={{fontWeight:700,color:"#555",whiteSpace:"nowrap",padding:"8px 12px"}}>{expandable&&chev(s.key)}{s.key==="acc"?<ApprovalRouteCell td={td} updTd={updTd}/>:s.label}
            {showReference&&<RefTag td={td} k={s.key}/>}</td>

          <td style={{minWidth:180}}>
            {s.special==="bidders"
              ?<div style={{display:"flex",flexDirection:"column",gap:4}}>
                <select value={val} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}} style={{border:"1px solid #e8e6df",background:"#fff",fontFamily:"inherit",fontSize:12,cursor:"pointer",outline:"none",borderRadius:5,padding:"3px 7px"}}>
                  {s.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}
                </select>
                <div onClick={function(){toggleRow(s.key);}} title="Open to edit bidders, prices and technical scores" style={{fontSize:11,color:"#6f6b62",cursor:"pointer"}}>{(function(){var bl=biddersOf(td);var aw=bl.find(function(b){return b.result==="awarded";});return bl.length+" bidder"+(bl.length===1?"":"s")+(aw&&aw.name?" · awarded: "+aw.name:"");})()}</div>
              </div>
              :<div style={{display:"flex",flexDirection:"column",gap:3}}>
{s.key==="acc"&&flowDocState(td,"acc")!=="none"?<FlowDocBadge td={td} id="acc"/>:
                <select value={val} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}} style={{border:"none",background:"transparent",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer",outline:"none",color:val&&val!=="—"?"inherit":"#bbb"}}>
                  {(s.key==="acc"?flowPresubOpts(s.opts):s.opts).map(function(o){return <option key={o} value={o}>{o}</option>;})}
                </select>}
                {s.key==="acc"&&<div style={{display:"flex",gap:4}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:8,fontWeight:800,color:"#888",marginBottom:1}}>SUBCONT.</div>
                    <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                      <input type="number" value={td.accAmountSubcontract||""} onChange={function(e){var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{accAmountSubcontract:e.target.value});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} placeholder="0" style={{width:"100%",padding:"2px 24px 2px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:4}}/>
                      <span style={{position:"absolute",right:3,fontSize:8,color:"#aaa",pointerEvents:"none"}}>{td.currency||"EUR"}</span>
                    </div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:8,fontWeight:800,color:"#888",marginBottom:1}}>OTHER</div>
                    <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                      <input type="number" value={td.accAmountOther||""} onChange={function(e){var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{accAmountOther:e.target.value});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} placeholder="0" style={{width:"100%",padding:"2px 24px 2px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:4}}/>
                      <span style={{position:"absolute",right:3,fontSize:8,color:"#aaa",pointerEvents:"none"}}>{td.currency||"EUR"}</span>
                    </div>
                  </div>
                </div>}
              </div>}
          </td>

          <td style={{textAlign:"center"}}>
            {theo.theoretical
              ?<span title={theo.locked
                  ?"The previous step is done, so this is a firm date, not an estimate."
                  :"Estimated from the previous step. It will move if the dates before it move."}
                style={{fontSize:11,fontWeight:theo.locked?800:600,cursor:"help",padding:"2px 7px",borderRadius:5,
                  color:theo.locked?"#00695c":"#8b8578",
                  background:theo.locked?"#e8f5e9":"#f2f0eb",
                  border:"1px solid "+(theo.locked?"#c8e6c9":"#e0ddd6")}}>{fmtDate(theo.theoretical)}</span>
              :<span style={{color:"#ddd",fontSize:11}}>—</span>}
            {theo.theoretical&&theo.target&&theo.target<theo.theoretical&&
              <div style={{fontSize:8,color:"#2e7d32",fontWeight:700,marginTop:1}}>target is earlier ✓</div>}
            {theo.theoretical&&theo.target&&theo.target>theo.theoretical&&
              <div style={{fontSize:8,color:"#c62828",fontWeight:700,marginTop:1}}>target is later</div>}
          </td>
          <td style={{textAlign:"center"}}>
            <input type="date" min="1990-01-01" max="2200-12-31" value={dates.target||""} onChange={function(e){updateStep(td.id,s.key,"target",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
            {!dates.target&&theo.theoretical&&<div><button onClick={function(){updateStep(td.id,s.key,"target",theo.theoretical);}}
              title="Adopt the theoretical date as the target" style={{fontSize:8,padding:"0 5px",marginTop:2,border:"1px solid #e8e6df",borderRadius:4,background:"#fff",cursor:"pointer",fontFamily:"inherit",color:"#888"}}>use theoretical</button></div>}
          </td>

          <td style={{textAlign:"center"}}>
            {s.key==="acc"?<div><FlowDocBadge td={td} id="acc" mode="sent"/>{recordBtn("acc")}</div>:
<input type="date" min="1990-01-01" max="2200-12-31" value={dates.done||""} onChange={function(e){updateStep(td.id,s.key,"done",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>}
          </td>

          <td style={{minWidth:200}}>
            {s.key==="acc"?<FlowDocBadge td={td} id="acc"/>:showApproval
              ?<div style={{display:"flex",flexDirection:"column",gap:4}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={dates.approval||""} onChange={function(e){updateStep(td.id,s.key,"approval",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%"}}/>
                <select value={getApprovalStatus(s.key)} onChange={function(e){var cur=Object.assign({},(td.stepDates||{})[s.key]||{});cur.approvalStatus=e.target.value;updateStep(td.id,s.key,"approvalDateObj",cur);var d=(tenders||[]).map(function(t){if(t.id!==td.id)return t;var sd=Object.assign({},t.stepDates||{});sd[s.key]=Object.assign({},sd[s.key]||{},{approvalStatus:e.target.value});var st=Object.assign({},t.steps||{});
                  // An A or a B IS the approval — nobody should have to set the Status column too.
                  if(isApprovedStatus(e.target.value))st[s.key]=e.target.value;
                  return Object.assign({},t,{stepDates:sd,steps:st});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 5px",fontSize:10,fontFamily:"inherit",fontWeight:700,color:getApprovalStatus(s.key).includes("Approved")?"#2e7d32":getApprovalStatus(s.key).includes("Rejected")||getApprovalStatus(s.key).includes("Not Approved")?"#c62828":"#888"}}>
                  {APPROVAL_OPTS.map(function(o){return <option key={o} value={o}>{o}</option>;})}
                </select>
              </div>
              :<span style={{color:"#e0ddd8"}}>—</span>}
          </td>

          <td style={{minWidth:150}}>
            {showReference
              ?<input type="text" value={getReference(s.key)} onChange={function(e){var d=(tenders||[]).map(function(t){if(t.id!==td.id)return t;var sd=Object.assign({},t.stepDates||{});sd[s.key]=Object.assign({},sd[s.key]||{},{reference:e.target.value});return Object.assign({},t,{stepDates:sd});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} placeholder={flowDocState(td,s.key)!=="none"?"Ref. missing":"Reference…"} title="Aconex / transmittal number of the document submitted"
                style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid "+(flowDocState(td,s.key)!=="none"&&!getReference(s.key)?"#f48fb1":"#e8e6df"),background:flowDocState(td,s.key)!=="none"&&!getReference(s.key)?"#fff8f9":"#fff",borderRadius:5,fontFamily:"var(--font-mono)",boxSizing:"border-box"}}/>
              :<span style={{color:"#e0ddd8"}}>—</span>}
          </td>

          <td style={{minWidth:200}}>
            <textarea value={comment} onChange={function(e){updateStep(td.id,s.key,"comment",e.target.value);}} placeholder="Add comment..." style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%",fontFamily:"inherit",resize:"vertical",minHeight:28,overflowY:"auto",boxSizing:"border-box"}}/>
            {linkCell(s)}
          </td>
        </tr>
        {expandable&&openRow[s.key]&&<tr><td colSpan={8} style={{background:"#faf9f6",padding:"6px 12px 10px 24px"}}>
          {s.special==="bidders"?<BiddersEditor td={td} updTd={updTd}/>:<DocRevisionsEditor td={td} d={flowDocOf(td,"acc")} updTd={updTd} afterSave={afterSave}/>}
        </td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>

    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>WMS &amp; ITP</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>driven by the start on site, not by the submission chain</span>
    </div>
    <table className="tbl" style={{fontSize:12,marginBottom:16}}>
      {!qaSteps.every(function(s){return isSynth(s.key);})&&<thead><tr>
        <th>Document</th><th>Status</th>
        <th style={{textAlign:"center",minWidth:96}} title="Start on site minus the lead time set in Settings › Durations">Theoretical</th>
        <th style={{textAlign:"center",minWidth:120}}>Submission target</th>
        <th style={{textAlign:"center",minWidth:110}}>Date done</th>
        <th style={{minWidth:110}}>Reference</th>
        <th style={{minWidth:190}}>Approval / Status</th>
      </tr></thead>}
      <tbody>{qaSteps.map(function(s){
        if(isSynth(s.key))return synthRow(s,6);
        var val=(td.steps||{})[s.key]||"";
        var dates=(td.stepDates||{})[s.key]||{};
        var th=(theoMap[s.key]||{});
        var lead=s.key==="wms"?getDur("wmsBeforeStart"):getDur("itpBeforeStart");
        return <React.Fragment key={s.key}><tr id={"tdoc-"+s.key}>
          <td style={{fontWeight:700,color:"#555",whiteSpace:"nowrap"}}>{chev(s.key)}{s.label}
            <div style={{fontSize:9,color:"#bbb",fontWeight:400}}>start − {lead} days</div><RefTag td={td} k={s.key}/></td>
          <td>
{flowDocState(td,s.key)!=="none"?<FlowDocBadge td={td} id={s.key}/>:
            <select value={val} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}}
              className={"chip "+tenderStepClass(s.key,val)} style={{padding:"3px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5}}>
              {flowPresubOpts(s.opts).map(function(o){return <option key={o} value={o}>{o}</option>;})}
            </select>}
          </td>
          <td style={{textAlign:"center"}}>
            {th.theoretical
              ?<span title={"Start on site "+fmtDate(td.startOnSite)+" minus "+lead+" days"}
                style={{fontSize:11,fontWeight:600,cursor:"help",padding:"2px 7px",borderRadius:5,color:"#8b8578",background:"#f2f0eb",border:"1px solid #e0ddd6"}}>{fmtDate(th.theoretical)}</span>
              :<span style={{color:"#ddd",fontSize:11}} title="No start on site yet — link a schedule task to this tender">—</span>}
          </td>
          <td style={{textAlign:"center"}}>
            <input type="date" min="1990-01-01" max="2200-12-31" value={dates.target||""} onChange={function(e){updateStep(td.id,s.key,"target",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
            {!dates.target&&th.theoretical&&<div><button onClick={function(){updateStep(td.id,s.key,"target",th.theoretical);}}
              style={{fontSize:8,padding:"0 5px",marginTop:2,border:"1px solid #e8e6df",borderRadius:4,background:"#fff",cursor:"pointer",fontFamily:"inherit",color:"#888"}}>use theoretical</button></div>}
          </td>
          <td style={{textAlign:"center"}}>
            <FlowDocBadge td={td} id={s.key} mode="sent"/>{recordBtn(s.key)}
          </td>
          <td>
            <input type="text" value={dates.reference||""} onChange={function(e){updateStep(td.id,s.key,"reference",e.target.value);}}
              placeholder="Ref…" title="Transmittal or document number"
              style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/>
          </td>
          <td><FlowDocBadge td={td} id={s.key}/>
          </td>
        </tr>
        {openRow[s.key]&&<tr><td colSpan={7} style={{background:"#faf9f6",padding:"6px 12px 10px 24px"}}>
          <DocRevisionsEditor td={td} d={flowDocOf(td,s.key)} updTd={updTd} afterSave={afterSave}/>
        </td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>

    {kickoffStep&&(function(){
      var val=(td.steps||{}).kickoff||"";
      var dates=(td.stepDates||{}).kickoff||{};
      var comment=(td.stepComments||{}).kickoff||"";
      var ks=kickoffState(td);
      var late=ks==="planned"&&isValidDate(dates.target)&&dates.target<today();
      return <React.Fragment>
        <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
          <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Kick off meeting</h3>
          <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>a planned date creates the action, the date held closes it</span>
        </div>
        <table className="tbl" style={{fontSize:12,marginBottom:16}}>
          <thead><tr>
            <th>Meeting</th><th>Status</th>
            <th style={{textAlign:"center",minWidth:120}}>Planned date</th>
            <th style={{textAlign:"center",minWidth:110}}>Date held</th>
            <th style={{minWidth:200}}>Comments</th>
          </tr></thead>
          <tbody><tr id="tdoc-kickoff">
            <td style={{fontWeight:700,color:"#555",whiteSpace:"nowrap"}}>{kickoffStep.label}</td>
            <td>
              <select value={val} onChange={function(e){updateStep(td.id,"kickoff","status",e.target.value);}}
                className={"chip "+(ks==="held"?"s-approved-a":tenderStepClass("kickoff",val))} style={{padding:"3px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5}}>
                {kickoffStep.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}
              </select>
            </td>
            <td style={{textAlign:"center"}}>
              <input type="date" min="1990-01-01" max="2200-12-31" value={dates.target||""} onChange={function(e){updateStep(td.id,"kickoff","target",e.target.value);}} style={{border:"1px solid "+(late?"#f48fb1":"#e8e6df"),borderRadius:5,padding:"3px 6px",fontSize:11}}/>
              {late&&<div style={{fontSize:9,color:"#c62828",fontWeight:700,marginTop:2}}>⚠️ date passed, not held</div>}
            </td>
            <td style={{textAlign:"center"}}>
              <input type="date" min="1990-01-01" max="2200-12-31" value={dates.done||""} onChange={function(e){updateStep(td.id,"kickoff","done",e.target.value);}} style={{border:"1px solid "+(dates.done?"#2e7d32":"#e8e6df"),borderRadius:5,padding:"3px 6px",fontSize:11}}/>
            </td>
            <td>
              <textarea value={comment} onChange={function(e){updateStep(td.id,"kickoff","comment",e.target.value);}} placeholder="Add comment..." style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%",fontFamily:"inherit",resize:"vertical",minHeight:28,overflowY:"auto",boxSizing:"border-box"}}/>
              {linkCell(kickoffStep)}
            </td>
          </tr></tbody>
        </table>
      </React.Fragment>;
    })()}

    </React.Fragment>}

    {part!=="docs"&&contractStep&&(function(){
      var ct=(td.stepDates||{}).contract||{};
      var accApproval=((td.stepDates||{}).acc||{}).approval||"";

      // Auto target dates (never overwrite existing manual values)
      var autoRequestTarget=accApproval?addWorkingDays(accApproval,getDur("accToRequest")):"";
      var autoCirculateTarget=ct.requestDone?addWorkingDays(ct.requestDone,getDur("requestToCirculate")):"";
      var autoSignedAllTarget=ct.circulateDone?addWorkingDays(ct.circulateDone,getDur("circulateToSign")):"";
      var autoSignedTarget=accApproval?addWorkingDays(accApproval,getDur("accToSigned")):"";

      var requestTarget=ct.requestTarget||autoRequestTarget;
      var circulateTarget=ct.circulateTarget||autoCirculateTarget;
      var signedAllTarget=ct.signedAllTarget||autoSignedAllTarget;
      var signedTarget=ct.signedTarget||autoSignedTarget;
      var signedDone=ct.signedDone||ct.signedAllDone||"";
      var ccObj=circuitOf(td);var ccState=circuitState(ccObj,today());

      // Accepts a field name or an object. Two successive calls rebuilt from the same stale
      // `tenders`, so only the second survived: "Signed contract" kept signedAllDone and
      // lost signedDone — which the procurement report was reading.
      function setCtField(field,val){
        var patch=(field&&typeof field==="object")?field:{[field]:val};
        if(td.contractCircuit&&Object.keys(patch).some(function(k){return /Done$/.test(k);})){
          setOpenRow(function(o){return Object.assign({},o,{circuit:true});});
          window.alert("This contract is tracked desk by desk. Record the dates in the Desk-by-desk circuit just below: these fields fill themselves.");
          return;
        }
        var d=(tenders||[]).map(function(t){
          if(t.id!==td.id)return t;
          var sd=Object.assign({},t.stepDates||{});
          sd.contract=Object.assign({},sd.contract||{},patch);
          return Object.assign({},t,{stepDates:sd});
        });
        saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));
      }
      var dateStyle={border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11};
      var autoDateStyle={border:"1px dashed #c9a84c",borderRadius:5,padding:"3px 6px",fontSize:11,background:"#fffdf0",color:"#b45309"};
      var doneStyle={border:"1px solid #2e7d32",borderRadius:5,padding:"3px 6px",fontSize:11};
      var rowStyle={borderBottom:"1px solid #f5f4f0"};
      var labelStyle={padding:"8px 12px",fontWeight:600,fontSize:12,color:"#555",whiteSpace:"nowrap"};

      function targetStyle(autoVal,manualVal){
        if(!autoVal&&!manualVal)return dateStyle;
        if(!manualVal&&autoVal)return autoDateStyle;
        return dateStyle;
      }
      function targetHint(autoVal,manualVal,label){
        if(autoVal&&!manualVal)return <div style={{fontSize:9,color:"#c9a84c",marginTop:2}}>{label}</div>;
        return null;
      }

      // Signed: the circuit is history. One line, like an approved document.
      if(!detail&&tenderPhase(td)==="sig"){
        var lab={fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:".05em",marginRight:5};
        var subs=(td.awards||[]).filter(function(a){return a.subcontractor;}).map(function(a){return a.subcontractor;});
        if(!subs.length&&td.contractor)subs=[td.contractor];
        var instr=String(td.instructionNumber||"").trim();
        var ctNote=String((td.stepComments||{}).contract||"").trim();
        return <div>
          <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
            <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Contract</h3>
            <button type="button" className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){setDetail(true);}} title="Show the request / circulation / signature dates and the desk-by-desk circuit">▾ Show the circuit</button>
          </div>
          <table className="tbl" style={{fontSize:12}}><tbody><tr style={{background:"#f2f9f3"}}>
            <td style={{padding:"8px 12px"}}>
              <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap",fontSize:12}}>
                <span className="chip s-approved-a" style={{fontSize:11,fontWeight:700}}>✅ Signed{signedDone?" · "+fmtDate(signedDone):""}</span>
                <span><span style={lab}>Subcontractor</span><b>{subs.length?subs.join(", "):"—"}</b></span>
                {instr&&<span><span style={lab}>Instruction</span><b style={{fontFamily:"var(--font-mono)"}}>{instr}</b></span>}
                {td.instructionAmount&&<span><span style={lab}>Instructed</span><b>{Number(td.instructionAmount).toLocaleString()}</b> {td.currency||"EUR"}</span>}
                {ctNote&&<span style={{color:"#6f6b62",fontStyle:"italic"}} title={ctNote}>“{ctNote.slice(0,80)}{ctNote.length>80?"…":""}”</span>}
              </div>
            </td>
          </tr></tbody></table>
        </div>;
      }

      return <div>
        <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)",flexWrap:"wrap"}}>
          <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Contract</h3>
          {accApproval&&<span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
            ACC/Aconex approval: <strong style={{color:"#2e7d32"}}>{fmtDate(accApproval)}</strong>
            {autoRequestTarget&&<span style={{color:"#c9a84c"}}> · Request target: {fmtDate(autoRequestTarget)}</span>}
            {autoSignedTarget&&<span style={{color:"#c9a84c"}}> · Signed target: {fmtDate(autoSignedTarget)}</span>}
          </span>}
        </div>
        <table className="tbl" style={{fontSize:12}}>
          <thead style={{background:"#f5f4f0"}}><tr>
            <th style={{minWidth:220}}>Sub-step</th>
            <th style={{textAlign:"center",minWidth:140}}>Target date <span style={{color:"#c9a84c",fontWeight:400,fontSize:9}}>(auto)</span></th>
            <th style={{textAlign:"center",minWidth:130}}>Date done</th>
          </tr></thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={labelStyle}>
                📤 Request sent
                <div style={{fontSize:9,color:"#aaa",fontWeight:400}}>ACC/Aconex approval +3 days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={requestTarget}
                  onChange={function(e){setCtField("requestTarget",e.target.value);}}
                  style={targetStyle(autoRequestTarget,ct.requestTarget)}/>
                {targetHint(autoRequestTarget,ct.requestTarget,"Auto: ACC+3d")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={ct.requestDone||""}
                  onChange={function(e){
                    setCtField("requestDone",e.target.value);
                    if(e.target.value){
                      closeAction("Contract Request to be sent — "+td.title);
                      autoAction("Contract to circulate — "+td.title);
                    }else{
                      removeAction("Contract to circulate — "+td.title);
                      reopenAction("Contract Request to be sent — "+td.title);
                    }
                  }}
                  style={ct.requestDone?doneStyle:dateStyle}/>
              </td>
            </tr>
            <tr style={rowStyle}>
              <td style={labelStyle}>
                📋 Contract to circulate
                <div style={{fontSize:9,color:"#aaa",fontWeight:400}}>Request done +7 days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={circulateTarget}
                  onChange={function(e){setCtField("circulateTarget",e.target.value);}}
                  style={targetStyle(autoCirculateTarget,ct.circulateTarget)}/>
                {targetHint(autoCirculateTarget,ct.circulateTarget,"Auto: request done+7d")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={ct.circulateDone||""}
                  onChange={function(e){
                    setCtField("circulateDone",e.target.value);
                    if(e.target.value){
                      closeAction("Contract to circulate — "+td.title);
                      autoAction("Contract to be signed internally and by the sub — "+td.title);
                    }else{
                      removeAction("Contract to be signed internally and by the sub — "+td.title);
                      reopenAction("Contract to circulate — "+td.title);
                    }
                  }}
                  style={ct.circulateDone?doneStyle:dateStyle}/>
              </td>
            </tr>
            {/* "Contract to be signed by all" and "Signed contract" were the same event
                recorded twice: the first row copied its date into the second. One row now. */}
            <tr style={{background:"#fffdf0"}}>
              <td style={Object.assign({},labelStyle,{color:"#b45309"})}>
                🏁 Signed contract
                <div style={{fontSize:9,color:"#c9a84c",fontWeight:400}}>ACC/Aconex approval +28 working days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={signedTarget}
                  onChange={function(e){setCtField("signedTarget",e.target.value);}}
                  style={targetStyle(autoSignedTarget,ct.signedTarget)}
                  title={autoSignedTarget?"Auto: ACC approval + 28 working days":"Enter ACC approval date to auto-calculate"}/>
                {targetHint(autoSignedTarget,ct.signedTarget,"Auto: ACC+28wd")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={signedDone}
                  onChange={function(e){
                    setCtField({signedDone:e.target.value,signedAllDone:e.target.value});   // one save, both fields
                    if(e.target.value){closeAction("Contract to be signed internally and by the sub — "+td.title);}
                    else{reopenAction("Contract to be signed internally and by the sub — "+td.title);}
                    if(e.target.value&&td.hasSD){
                      // Only create the SD task if the SD status cycle hasn't already opened one for this tender
                      var sdCycleTexts=["Prepare the SD — "+td.title,"Get approval for SD — "+td.title,"Resubmit SD — "+td.title];
                      var sdAlreadyTracked=(tasks||[]).some(function(t){
                        return t.tenderRef===td.id&&t.status!=="done"&&(sdCycleTexts.indexOf(t.text)>=0||(t.text||"").indexOf("SD to be submitted: "+td.title)===0);
                      });
                      if(!sdAlreadyTracked){
                        var qtag=qualityTag(td.package||"");
                        autoAction("SD to be submitted: "+td.title,qtag,td.sdTarget||"");
                      }
                    }else if(!e.target.value&&td.hasSD){
                      removeAction("SD to be submitted: "+td.title);
                    }
                  }}
                  style={signedDone?doneStyle:dateStyle}/>
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{padding:"8px 12px",borderTop:"1px solid #f0ede6"}}>
          <button type="button" className="btn btn-sm" onClick={function(){toggleRow("circuit");}}>{openRow.circuit?"▾":"▸"} Desk-by-desk circuit</button>
          <span style={{fontSize:11,color:"#6f6b62",marginLeft:8}}>{ccObj.stored?(ccState.current.length?ccState.current.length+" desk"+(ccState.current.length>1?"s":"")+" open":"tracked"):"not tracked yet"}</span>
          {openRow.circuit&&<div style={{marginTop:8}}><ContractCircuitEditor td={td} updTd={updTd} afterSave={afterSave}/></div>}
        </div>
        <div style={{padding:"8px 12px",borderTop:"1px solid #f0ede6"}}>
          <textarea value={(td.stepComments||{}).contract||""} onChange={function(e){updateStep(td.id,"contract","comment",e.target.value);}} placeholder="Contract comments..." style={{border:"1px solid #e8e6df",borderRadius:5,padding:"5px 8px",fontSize:11,width:"100%",fontFamily:"inherit",resize:"vertical",minHeight:36,boxSizing:"border-box"}}/>
        </div>
      </div>;
    })()}
    </div>
  </div>;
}


// ============================================================================================
// Awards: one tender → one or several subcontractors, each with its own contract conditions.
// Stored in the tender itself (td.awards). The financial table has exactly the shape of the
// tender-review MoM (`fin`, see newMomFin / momFinRows / MomFinEditor in app-reports.js), so a
// Final review is copied across in one go and both print the same wording.
// ============================================================================================
// ---------------------------------------------------------------------------
// TenderFlowPanel — "Flow & history" card at the top of the tender sheet.
//
//   1. Indicators: resubmissions, delay vs plan, average client review, average turnaround
//   2. Week-by-week timeline: one lane per step, one bar per cycle, colour = who holds it
//   3. Recap of every document's submissions; shop drawings and materials are edited here
//      (R0, R1… with codes A/B/C/D). ACC, WMS and ITP are edited in Submission steps.
//   The contract circuit and the bidders (price, score) now live in Submission steps too:
//   see ContractCircuitEditor / BiddersEditor above.
//
// Every edit is ONE updTd(patch) call, built by the *With* helpers so the legacy fields
// (Submission steps table, reports, calcProcurement) stay in step.
// MAR / MSS / SD cycles are shown on the timeline and edited in the Submissions recap.
// ---------------------------------------------------------------------------
const FLOW_COL={us:"#b9b4a8",client:"#1a73e8",sub:"#7b1fa2",internal:"#d85a30",returned:"#c62828"};
const FLOW_CODE_COL={A:["#e8f5e9","#1e6b3a"],B:["#e0f2f1","#00695c"],C:["#fff3e0","#b35c00"],D:["#fce4ec","#b3302a"]};
function _flowWeek(iso){
  var d=new Date(iso+"T00:00:00");var t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  var day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);
  var y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y0)/86400000+1)/7);
}
function _flowMonday(iso){var d=new Date(iso+"T00:00:00");var k=(d.getDay()+6)%7;return addCalDays(iso,-k);}
function _flowAvg(a){return a.length?Math.round(a.reduce(function(x,y){return x+y;},0)/a.length):null;}
// When the client is expected to answer, per document, from the plan (target or theoretical).
function _flowPlanApproval(td,k,theo){
  var sd=((td.stepDates||{})[k])||{};
  var sub=sd.target||((theo[k]||{}).theoretical)||"";
  if(!isValidDate(sub))return"";
  return k==="acc"?addWorkingDays(sub,getDur("accApproval")):addCalDays(sub,getDur("clientResponse"));
}

// ---------------------------------------------------------------------------
// Editors used inside Submission steps (revisions, contract circuit, tender results).
// They used to live inside TenderFlowPanel; the code is the same, only the place changed.
// Every edit is still ONE updTd(patch) call followed by afterSave.
// ---------------------------------------------------------------------------
// The reference of a submitted document, shown on the step row itself so it stays
// visible with the revisions folded. Red when the document went out without one.
// Typed in full, saved on leaving the field or Enter: saving on every key would turn the
// line into "Doc no. X" after the first character.
function RefMissingInput({onSave}){
  const [v,setV]=useState("");
  function commit(){var x=v.trim();if(x)onSave(x);}
  return <input type="text" value={v} placeholder="ref. missing" title="Aconex / transmittal number — saved when you leave the field or press Enter"
    onChange={function(e){setV(e.target.value);}} onBlur={commit} onKeyDown={function(e){if(e.key==="Enter")commit();}}
    style={{width:150,fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 6px",border:"1px solid #f48fb1",background:"#fff8f9",borderRadius:5}}/>;
}
function RefTag({td,k}){
  var ref=String((((td.stepDates||{})[k])||{}).reference||"").trim();
  var sent=flowDocState(td,k)!=="none";
  if(ref)return <div title="Document reference" style={{fontFamily:"var(--font-mono)",fontSize:10.5,fontWeight:600,color:"#1a73e8",marginTop:3,whiteSpace:"nowrap"}}>Ref. {ref}</div>;
  if(sent)return <div title="Submitted, but no reference recorded: type it in the Reference column" style={{fontSize:10,fontWeight:700,color:"#c62828",marginTop:3}}>⚠ ref. missing</div>;
  return null;
}
// ---------------------------------------------------------------------------
// Document reference at submission time — ONE path for every document kind.
// Each submission (R0, R1…) keeps the reference it went out with (cycle.ref); the document
// keeps the latest one where every view already reads it:
//   ACC / WMS / ITP → stepDates[k].reference · MAR / MSS → mat.marRef / mat.mssRef
//   SD transmission → t.ref (only filled when empty: it names the transmission)
// ---------------------------------------------------------------------------
function docCurRef(td,d){
  if(!d)return"";
  if(d.kind==="acc"||d.kind==="wms"||d.kind==="itp")return String((((td.stepDates||{})[d.kind])||{}).reference||"").trim();
  if(d.kind==="mar"||d.kind==="mss"||isPurchaseDoc(d))return String(d.ref||"").trim();
  if(d.kind==="sd"&&d.id!=="sd:_main"){var t=(td.sdTransmissions||[]).find(function(x){return "sd:"+x.id===d.id;});return String((t&&t.ref)||"").trim();}
  return"";
}
function docRefPatch(td,d,patch,ref){
  if(d.kind==="acc"||d.kind==="wms"||d.kind==="itp"){
    var sdp=Object.assign({},td.stepDates||{},patch.stepDates||{});
    sdp[d.kind]=Object.assign({},sdp[d.kind]||{},{reference:ref});
    return Object.assign({},patch,{stepDates:sdp});
  }
  if(d.kind==="mar"||d.kind==="mss"){
    var mid=d.id.slice(d.kind.length+1);
    var ms=(patch.materials||td.materials||[]).map(function(x,j){
      if(String((x&&x.id)||j)!==mid)return x;var u=Object.assign({},x);u[d.kind+"Ref"]=ref;return u;});
    return Object.assign({},patch,{materials:ms});
  }
  if(isPurchaseDoc(d)){
    var pid=d.id.slice(d.kind.length+1),f=d.kind==="pacc"?"accRef":"aconexRef";
    var ps=(patch.purchases||td.purchases||[]).map(function(x){
      if(x.id!==pid)return x;var u=Object.assign({},x);u[f]=ref;return u;});
    return Object.assign({},patch,{purchases:ps});
  }
  if(d.kind==="sd"&&d.id!=="sd:_main"){
    var tl=(patch.sdTransmissions||td.sdTransmissions||[]).map(function(x){
      return "sd:"+x.id===d.id&&!String(x.ref||"").trim()?Object.assign({},x,{ref:ref}):x;});
    return Object.assign({},patch,{sdTransmissions:tl});
  }
  return patch;
}
// Brings a document's row into view (the register in Flow & history links to it).
function scrollToDoc(id){
  setTimeout(function(){
    var el=document.getElementById("tdoc-"+id);if(!el)return;
    try{el.scrollIntoView({behavior:"smooth",block:"center"});}catch(e){el.scrollIntoView();}
    el.classList.add("tdoc-flash");setTimeout(function(){el.classList.remove("tdoc-flash");},1800);
  },120);
}
// Records R0 (or the next revision after a C/D) sent today, after asking its reference.
// Resolves to the patch saved, or null when cancelled.
function recordDocSubmission(td,d,updTd,afterSave){
  if(!d||!updTd||!canAddCycle(d.cycles))return Promise.resolve(null);
  if(blockIfReadOnly())return Promise.resolve(null);
  var last=d.cycles[d.cycles.length-1];
  var rev=last?last.rev+1:0;
  var cur=docCurRef(td,d);
  var name=(d.kind==="acc"?d.label:d.kind==="sd"?"Shop drawing":d.label)+((d.group==="Materials"||d.group==="Purchases")&&d.sub?" — "+d.sub:"")+(d.kind==="sd"&&d.sub?" — "+d.sub:"");
  return ppPrompt({
    title:(rev?"Resubmission R"+rev:"Submission")+" · "+name,
    message:"Reference of the document sent to the client (Aconex / transmittal number).\nLeave empty if it is not known yet: the row will show “ref. missing” until it is typed.",
    value:rev?"":cur,placeholder:"e.g. RT-TRM-001234",okLabel:"Record submission",mono:true
  }).then(function(ref){
    if(ref===null)return null;
    ref=String(ref).trim();
    var patch=d.patchFor(addCycle(d.cycles,{submitted:today(),ref:ref}));
    if(ref&&ref!==cur)patch=docRefPatch(td,d,patch,ref);
    updTd(patch);
    if(afterSave)afterSave(td,Object.assign({},td,patch));
    return patch;
  });
}
function DocRevisionsEditor({td,d,updTd,afterSave}){
  var now=today();
  function saveDoc(d,list){
    var patch=d.patchFor(list);
    updTd(patch);
    if(afterSave)afterSave(td,Object.assign({},td,patch));
  }
  // The latest revision's reference is also the document's: keep both in one save.
  function saveRef(d,list,c,val){
    var patch=d.patchFor(updCycle(list,c.id,{ref:val}));
    if(c.id===list[list.length-1].id)patch=docRefPatch(td,d,patch,val);
    updTd(patch);
  }
  var STATE_COL={approved:"#1e6b3a",pending:"#1a73e8",returned:"#b35c00",none:"#9b968b"};
  function _docEditor(d){
    var list=d.cycles;var last=list[list.length-1];
    var inp={padding:"3px 6px",fontSize:12,width:"auto"};
    return <div style={{background:"#fafaf8",border:"1px solid #ece9e1",borderRadius:8,padding:"8px 10px",margin:"2px 0 8px 18px"}}>
      {list.length===0&&<div style={{fontSize:12,color:"#9b968b",marginBottom:6}}>Not submitted yet.</div>}
      {list.length>0&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{color:"#9b968b",fontSize:10,textTransform:"uppercase",letterSpacing:".06em",textAlign:"left"}}>
          <th style={{padding:"4px 6px"}}>Rev</th><th>Reference</th><th>Submitted</th><th>Returned</th><th>Code</th><th>Comment</th><th style={{textAlign:"right"}}>With client</th>
        </tr></thead>
        <tbody>{list.map(function(c,i){
          var isLast=i===list.length-1;
          var days=isValidDate(c.submitted)?Math.round((new Date(isValidDate(c.returned)?c.returned:now)-new Date(c.submitted))/86400000):null;
          var ov=isLast&&!c.returned&&!c.code?docOverdue(d,c.submitted,now):null;
          var k=FLOW_CODE_COL[c.code];
          return <tr key={c.id} style={{borderTop:"1px solid #f0ede6"}}>
            <td style={{padding:"4px 6px",fontFamily:"var(--font-mono,monospace)",fontWeight:700}}>R{c.rev}</td>
            <td><input type="text" value={c.ref!==undefined?c.ref:(isLast?docCurRef(td,d):"")} placeholder={c.submitted?"ref. missing":"ref…"}
              title="Aconex / transmittal number this revision went out with"
              style={Object.assign({},inp,{width:130,fontFamily:"var(--font-mono)",fontSize:11},c.submitted&&!(c.ref||(isLast&&docCurRef(td,d)))?{border:"1px solid #f48fb1",background:"#fff8f9"}:{})}
              onChange={function(e){saveRef(d,list,c,e.target.value);}}/></td>
            <td><input type="date" value={c.submitted||""} disabled={!isLast} style={inp} onChange={function(e){saveDoc(d,updCycle(list,c.id,{submitted:e.target.value}));}}/></td>
            <td><input type="date" value={c.returned||""} disabled={!isLast} style={inp} onChange={function(e){saveDoc(d,updCycle(list,c.id,{returned:e.target.value}));}}/></td>
            <td><select value={c.code||""} disabled={!isLast} style={Object.assign({},inp,k?{background:k[0],color:k[1],fontWeight:700}:{})}
              onChange={function(e){var p={code:e.target.value};if(e.target.value&&!c.returned)p.returned=now;saveDoc(d,updCycle(list,c.id,p));}}>
              <option value="">pending</option>
              {CYCLE_CODES.map(function(o){return <option key={o.k} value={o.k}>{o.k} — {o.label}</option>;})}
            </select></td>
            <td><input type="text" value={c.comment||""} placeholder="client comment" style={Object.assign({},inp,{width:"100%",minWidth:120})}
              onChange={function(e){saveDoc(d,updCycle(list,c.id,{comment:e.target.value}));}}/></td>
            <td style={{textAlign:"right",color:days!==null&&!c.returned?"#1a73e8":"#6f6b62",whiteSpace:"nowrap"}}>{days===null?"—":days+" d"+(c.returned?"":" …")}<OverdueTag o={ov}/></td>
          </tr>;
        })}</tbody>
      </table>}
      <div style={{display:"flex",gap:8,alignItems:"center",marginTop:6,flexWrap:"wrap"}}>
        {canAddCycle(list)&&<button className="btn btn-sm" onClick={function(){recordDocSubmission(td,d,updTd,afterSave);}}>
          {list.length?"↻ Resubmit as R"+(last.rev+1):"+ Record the submission"}</button>}
        {last&&!last.code&&last.submitted&&<span style={{fontSize:11,color:"#1a73e8"}}>Waiting for the client on R{last.rev}. Set the code when it comes back.</span>}
        {list.length>0&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){
          if(safeConfirm(list.length>1?"Remove R"+last.rev+"? The previous revision becomes the current one again.":"Remove this submission? The document goes back to not submitted."))saveDoc(d,delLastCycle(list));}}>
          ✕ Remove R{last.rev}</button>}
      </div>
    </div>;
  }
  return _docEditor(d);
}
function ContractCircuitEditor({td,updTd,afterSave}){
  var now=today();
  var cc=circuitOf(td);
  var cs=circuitState(cc,now);
  function saveCircuit(events,def){
    var n=tdWithCircuit(td,{def:def||cc.def,events:events});
    var patch={contractCircuit:n.contractCircuit,stepDates:n.stepDates,steps:n.steps};
    updTd(patch);
    if(afterSave)afterSave(td,Object.assign({},td,patch));
  }
  function circuit(){
    if(!cc.stored){
      return <div style={{fontSize:12,color:"#6f6b62"}}>
        <div style={{marginBottom:8}}>Not tracked desk by desk yet{cc.events.length?" — dates above come from the sub-steps":""}.</div>
        <button className="btn btn-sm" onClick={function(){saveCircuit(cc.events.map(function(e){var n=Object.assign({},e,{id:uuid()});delete n.legacy;return n;}),cc.def);}}>
          ▶ Track the contract circuit</button>
        <span style={{fontSize:10.5,color:"#9b968b",marginLeft:8}}>Uses the stages set in Settings → Durations → Contract circuit.</span>
      </div>;
    }
    var inp={padding:"2px 5px",fontSize:11.5,width:"auto"};
    function setEv(id,patch){saveCircuit(cc.events.map(function(e){return e.id===id?Object.assign({},e,patch):e;}));}
    function arrive(stageId){saveCircuit(cc.events.concat([newCircuitEvent({stageId:stageId,in:now})]));}
    var branchLbl={start:"",internal:"Internal",sub:"With sub",join:"",end:""};
    return <div>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12,marginBottom:8}}>
        <span>Total <b>{cs.totalDays===null?"—":cs.totalDays+" d"}</b>{cs.signedAll?" · signed by all "+fmtDate(cs.signedAll):""}</span>
        {cs.current.length>0&&<span style={{color:"#1a73e8"}}>Now: {cs.current.map(function(x){return x.stage.label.replace(/^Circulation to /,"")+" · "+Math.round((new Date(now)-new Date(x.since))/86400000)+" d";}).join(" / ")}</span>}
      </div>
      {cs.stages.map(function(x,i){
        var s=x.stage,last=x.events[x.events.length-1];
        var dot={done:["#1e6b3a","✓"],current:["#1a73e8",i+1],returned:["#c62828","↩"],blocked:["#c9c4b8",i+1],todo:["#fff",i+1]}[x.state];
        var prevBranch=i>0?cs.stages[i-1].stage.branch:"";
        return <div key={s.id}>
          {s.branch!==prevBranch&&branchLbl[s.branch]&&<div style={{fontSize:10,fontWeight:700,color:s.branch==="sub"?FLOW_COL.sub:FLOW_COL.internal,textTransform:"uppercase",letterSpacing:".06em",margin:"8px 0 2px 30px"}}>
            {branchLbl[s.branch]}{s.branch==="sub"?" — runs in parallel with the internal circulation":""}</div>}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px solid #f5f3ee",flexWrap:"wrap"}}>
            <span style={{width:20,height:20,borderRadius:"50%",flex:"0 0 20px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,
              background:dot[0],color:x.state==="todo"?"#9b968b":"#fff",border:x.state==="todo"?"1px solid #c9c4b8":"none"}}>{dot[1]}</span>
            <span style={{flex:"1 1 200px",fontSize:12,fontWeight:x.state==="current"?700:500,color:x.state==="todo"||x.state==="blocked"?"#9b968b":"#16181d"}}>{s.label}
              {x.returns>0&&<span className="badge" style={{marginLeft:6,background:"#fce4ec",color:"#b3302a"}}>{x.returns} return{x.returns>1?"s":""}</span>}
              {x.state==="blocked"&&<span style={{fontSize:10.5,color:"#9b968b",fontWeight:400,marginLeft:6}}>waits for both branches</span>}
            </span>
            {last&&<span style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}>
              in <input type="date" value={last.in||""} style={inp} onChange={function(e){setEv(last.id,{in:e.target.value});}}/>
              out <input type="date" value={last.out||""} style={inp} onChange={function(e){setEv(last.id,{out:e.target.value,outcome:e.target.value?(last.outcome==="returned"?"returned":"ok"):""});}}/>
            </span>}
            <span title={"Target "+s.days+" d at this desk"} style={{fontSize:11,width:62,textAlign:"right",fontWeight:600,color:x.late?"#b3302a":x.days?"#1e6b3a":"#9b968b"}}>
              {x.days?x.days+" / "+s.days+" d":s.days+" d"}</span>
            <span style={{display:"flex",gap:4,width:150,justifyContent:"flex-end"}}>
              {(!last||x.state==="returned")&&x.state!=="blocked"&&<button className="btn btn-sm" style={{fontSize:10.5,padding:"1px 7px"}} onClick={function(){arrive(s.id);}}>{last?"↻ Back at desk":"▶ Arrived"}</button>}
              {x.state==="current"&&<button className="btn btn-sm" style={{fontSize:10.5,padding:"1px 7px"}} onClick={function(){setEv(last.id,{out:now,outcome:"ok"});}}>✓ Released</button>}
              {x.state==="current"&&s.canReturn&&<button className="btn btn-sm" style={{fontSize:10.5,padding:"1px 7px",color:"#b3302a"}} onClick={function(){
                var why=window.prompt("Why is it sent back? (shown in the history and the reports)","");if(why===null)return;
                setEv(last.id,{out:now,outcome:"returned",comment:why});}}>↩ Return</button>}
            </span>
          </div>
          {x.events.filter(function(e){return e.outcome==="returned";}).map(function(e){
            return <div key={e.id} style={{fontSize:10.5,color:"#b3302a",margin:"0 0 2px 30px"}}>↩ returned {fmtDate(e.out)}{e.comment?" — "+e.comment:""}</div>;})}
        </div>;
      })}
      <div style={{fontSize:10.5,color:"#9b968b",marginTop:6}}>The sub-steps above fill themselves from this circuit.</div>
    </div>;
  }
  return circuit();
}
function BiddersEditor({td,updTd}){
  function saveBidders(list){updTd({bidders:list.map(function(b){var n=Object.assign({},b);delete n.legacy;return n;})});}
  function bidders(){
    var list=biddersOf(td);
    var budget=Number(td.budget)||0,cur=td.currency||"EUR";
    var prices=list.map(function(b){return Number(b.price)||0;}).filter(function(p){return p>0;});
    var lo=prices.length?Math.min.apply(null,prices):0,mx=Math.max.apply(null,prices.concat([budget,1]));
    function upd(id,k,v){saveBidders(list.map(function(b){if(b.id!==id)return b;var n=Object.assign({},b);n[k]=v;return n;}));}
    var inp={padding:"3px 6px",fontSize:12,width:"auto"};
    var sorted=list.slice().sort(function(a,b){return (Number(a.price)||1e15)-(Number(b.price)||1e15);});
    return <div>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:11.5,color:"#6f6b62",marginBottom:6}}>
        <span>Tender issued <input type="date" value={td.tenderIssued||""} style={inp} onChange={function(e){updTd("tenderIssued",e.target.value);}}/></span>
        <span>Bids received <input type="date" value={td.bidsReceived||""} style={inp} onChange={function(e){updTd("bidsReceived",e.target.value);}}/></span>
        <span>Budget <b>{budget?budget.toLocaleString()+" "+cur:"—"}</b></span>
      </div>
      {list.length>0&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{color:"#9b968b",fontSize:10,textTransform:"uppercase",letterSpacing:".06em",textAlign:"left"}}>
          <th style={{padding:"4px 6px"}}>#</th><th>Bidder</th><th>Price ({cur})</th><th>Tech /100</th><th style={{width:"22%"}}>vs budget</th><th>Result</th><th/>
        </tr></thead>
        <tbody>{sorted.map(function(b,i){
          var p=Number(b.price)||0;
          return <tr key={b.id} style={{borderTop:"1px solid #f0ede6"}}>
            <td style={{padding:"4px 6px",color:"#9b968b"}}>{p?i+1:""}</td>
            <td><input type="text" value={b.name} style={Object.assign({},inp,{width:"100%",minWidth:140,fontWeight:b.result==="awarded"?700:400})} onChange={function(e){upd(b.id,"name",e.target.value);}}/></td>
            <td><input type="number" value={b.price} style={Object.assign({},inp,{width:110,textAlign:"right"})} onChange={function(e){upd(b.id,"price",e.target.value);}}/>
              {p>0&&<div style={{fontSize:10,color:"#9b968b"}}>{p===lo?"lowest":"+"+Math.round((p/lo-1)*100)+" %"}</div>}</td>
            <td><input type="number" min="0" max="100" value={b.techScore} style={Object.assign({},inp,{width:60,textAlign:"right"})} onChange={function(e){upd(b.id,"techScore",e.target.value);}}/></td>
            <td><div style={{position:"relative",height:12,background:"#f5f3ee",borderRadius:2}}>
              {p>0&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:(p/mx*100)+"%",borderRadius:2,background:b.result==="awarded"?"#1e6b3a":budget&&p>budget?"#c62828":"#b9b4a8"}}/>}
              {budget>0&&<div title={"Budget "+budget.toLocaleString()} style={{position:"absolute",top:-2,bottom:-2,left:(budget/mx*100)+"%",borderLeft:"2px solid #16181d"}}/>}
            </div></td>
            <td><select value={b.result||""} style={inp} onChange={function(e){upd(b.id,"result",e.target.value);}}>
              <option value="">in review</option><option value="awarded">awarded</option><option value="declined">declined</option><option value="withdrawn">withdrawn</option></select></td>
            <td><button className="btn btn-sm" style={{padding:"1px 7px"}} onClick={function(){if(safeConfirm("Remove "+(b.name||"this bidder")+"?"))saveBidders(list.filter(function(x){return x.id!==b.id;}));}}>✕</button></td>
          </tr>;
        })}</tbody>
      </table>}
      <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
        <button className="btn btn-sm" onClick={function(){saveBidders(list.concat([newBidder()]));}}>+ Add bidder</button>
        {list.some(function(b){return b.legacy;})&&<span style={{fontSize:10.5,color:"#9b968b"}}>Names read from the old bidders list; the first edit saves them here.</span>}
        <span style={{fontSize:10.5,color:"#9b968b",marginLeft:"auto"}}>The awarded subcontractor and its contract terms stay in the Awards panel.</span>
      </div>
    </div>;
  }
  return bidders();
}

function TenderFlowPanel({td,updTd,afterSave,onJump}){
  const [open,setOpen]=useState({timeline:true,cycles:true,circuit:true,bidders:false});
  var now=today();
  var theo=(function(){try{return theoreticalDates(td);}catch(e){return{};}})();
  var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
  var docs=tenderDocs(td);
  var sums={};docs.forEach(function(d){sums[d.id]=docSummary(d,now);});
  var cyc={};["acc","wms","itp"].forEach(function(k){cyc[k]=(docs.find(function(d){return d.id===k;})||{cycles:[]}).cycles;});
  var mats=(td.materials||[]);
  var sdList=(td.sdTransmissions||[]);
  var cc=circuitOf(td);
  var cs=circuitState(cc,now);

  // ---- indicators over every document of the tender ----
  var all=docs.map(function(d){return {k:d.kind,c:d.cycles,plan:d.theoApproval};});
  var revs=0,rv=[],tn=[],delay=null;
  docs.forEach(function(d){
    var s=sums[d.id].stats;revs+=s.revisions;rv=rv.concat(s.reviewDays);tn=tn.concat(s.turnDays);
    var v=sums[d.id].vsTheo;if(v!==null&&(delay===null||v>delay))delay=v;
  });

  function chip(label,val,col,tip){
    return <div title={tip||""} style={{background:"#fafaf8",border:"1px solid #ece9e1",borderRadius:8,padding:"7px 12px",minWidth:110,cursor:tip?"help":"default"}}>
      <div style={{fontSize:9.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"#6f6b62"}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700,color:col||"#16181d"}}>{val}</div>
    </div>;
  }
  function head(key,title,extra){
    return <div onClick={function(){var o=Object.assign({},open);o[key]=!o[key];setOpen(o);}}
      style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",margin:"14px 0 6px",userSelect:"none"}}>
      <span style={{fontSize:10,color:"#9b968b",width:10}}>{open[key]?"▾":"▸"}</span>
      <span style={{fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#6f6b62"}}>{title}</span>
      {extra}
    </div>;
  }

  // ---- 2. timeline ----
  function timeline(){
    var dates=[now];
    function push(d){if(isValidDate(d))dates.push(d);}
    push(td.tenderIssued);push(td.bidsReceived);push(proc.deliveryDate);push(td.startOnSite);push(proc.fabStart);
    all.forEach(function(x){push(x.plan);x.c.forEach(function(c){push(c.submitted);push(c.returned);});});
    cc.events.forEach(function(e){push(e.in);push(e.out);});
    dates.sort();
    var from=_flowMonday(addCalDays(dates[0],-7));
    var to=addCalDays(dates[dates.length-1],14);
    var nW=Math.max(6,Math.ceil((new Date(to)-new Date(from))/86400000/7));
    var span=nW*7;
    function X(d){var v=(new Date(d)-new Date(from))/86400000/span*100;return Math.max(0,Math.min(100,v));}
    function seg(a,b,col,tip,dashed,key){
      if(!isValidDate(a))return null;var e=isValidDate(b)?b:now;
      return <div key={key} title={tip} style={{position:"absolute",top:"50%",marginTop:-5,height:10,borderRadius:3,
        left:X(a)+"%",width:Math.max(0.6,X(e)-X(a))+"%",
        background:dashed?"transparent":col,border:dashed?"1.5px dashed "+col:"none",opacity:isValidDate(b)||dashed?1:.55}}/>;
    }
    function code(d,k,key,tip){
      if(!isValidDate(d)||!k)return null;var c=FLOW_CODE_COL[k];
      return <div key={key} title={tip} style={{position:"absolute",top:"50%",marginTop:-9,left:X(d)+"%",marginLeft:-9,width:18,height:18,borderRadius:4,
        background:c[0],color:c[1],border:"1px solid "+c[1],fontSize:10,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>{k}</div>;
    }
    function planMark(d){if(!isValidDate(d))return null;
      return <div title={"Planned approval "+fmtDate(d)} style={{position:"absolute",top:2,bottom:2,left:X(d)+"%",borderLeft:"1.5px dashed #9b968b"}}/>;}
    function cycleBars(list,who,pre){
      var out=[];
      list.forEach(function(c,i){
        out.push(seg(c.submitted,c.returned,FLOW_COL.client,pre+" R"+c.rev+" with client: "+fmtDate(c.submitted)+" → "+(c.returned?fmtDate(c.returned):"pending"),false,pre+"s"+i));
        out.push(code(c.returned,c.code,pre+"c"+i,pre+" R"+c.rev+" returned "+fmtDate(c.returned)+" — "+((cycleCodeInfo(c.code)||{}).label||"")));
        var nx=list[i+1];
        if(nx&&isValidDate(c.returned))out.push(seg(c.returned,nx.submitted,FLOW_COL[who],pre+" rework after R"+c.rev,false,pre+"t"+i));
      });
      return out;
    }
    // Forecast of the steps still to come, from the same cascade as the Delivery cell
    // (calcProcurement): dashed bars. They explain the gap between the ACC approval and
    // the fabrication: contract signing, then shop drawings, then the lead material.
    function pst(k){return (proc.steps||[]).find(function(x){return x.key===k;})||{};}
    var fAccSub=pst("accSub"),fAcc=pst("accApp"),fCt=pst("contract"),fSdS=pst("sdSub"),fSdA=pst("sdApp");
    var accEnd=fAcc.done||fAcc.date;
    var ctEnd=fCt.done||fCt.date;
    var lanes=[];
    // Tender: bidders pricing, then evaluation up to the first ACC submission
    var acc0=(cyc.acc[0]||{}).submitted;
    lanes.push({k:"tender",label:"Tender",sub:"issue → bids",bars:[
      seg(td.tenderIssued,td.bidsReceived,FLOW_COL.sub,"Bidders pricing "+fmtDate(td.tenderIssued)+" → "+fmtDate(td.bidsReceived||""),!td.bidsReceived,"t1"),
      td.bidsReceived&&acc0?seg(td.bidsReceived,acc0,FLOW_COL.us,"Evaluation and ACC preparation","", "t2"):null]});
    var accBars=cycleBars(cyc.acc,"us","ACC");
    if(!fAcc.done&&isValidDate(fAcc.date)){
      var lastAcc=cyc.acc[cyc.acc.length-1];
      var fs=lastAcc&&lastAcc.submitted&&!lastAcc.code?"":(lastAcc&&lastAcc.code?fAcc.date:(fAccSub.date||""));
      if(lastAcc&&(lastAcc.code==="C"||lastAcc.code==="D"))fs="";
      if(isValidDate(fs)&&fs<fAcc.date)accBars.push(seg(fs,fAcc.date,FLOW_COL.client,"Forecast: ACC submittal "+fmtDate(fs)+" → approval "+fmtDate(fAcc.date),true,"accf"));
    }
    lanes.push({k:"acc",label:tenderRouteLabel(td),sub:cyc.acc.length>1?cyc.acc.length+" submissions":"submission → client",plan:(docs.find(function(d){return d.id==="acc";})||{}).theoApproval,bars:accBars});
    // Contract: internal on the upper half, sub on the lower half, start/join/end across
    var cbars=[];
    cs.stages.forEach(function(x,si){
      x.events.forEach(function(e,ei){
        var col=e.outcome==="returned"?FLOW_COL.returned:x.stage.branch==="internal"?FLOW_COL.internal:x.stage.branch==="sub"?FLOW_COL.sub:FLOW_COL.us;
        var b=seg(e.in,e.outcome?e.out:"",col,x.stage.label+": "+fmtDate(e.in)+" → "+(e.out?fmtDate(e.out):"waiting")+(e.outcome==="returned"?" · returned"+(e.comment?": "+e.comment:""):""),false,"cc"+si+"-"+ei);
        if(b&&(x.stage.branch==="internal"||x.stage.branch==="sub")){
          b=React.cloneElement(b,{style:Object.assign({},b.props.style,{height:7,marginTop:x.stage.branch==="internal"?-9:2})});
        }
        cbars.push(b);
      });
    });
    if(!fCt.done&&isValidDate(fCt.date)&&isValidDate(accEnd)&&accEnd<fCt.date){
      cbars.push(seg(cs.started&&cs.started>accEnd?cs.started:accEnd,fCt.date,FLOW_COL.internal,
        "Forecast: contract signed "+fmtDate(fCt.date)+" ("+getDur("contractSigning")+" working days after the ACC approval)",true,"ctf"));
    }
    lanes.push({k:"contract",label:"Contract",sub:fCt.done?"signed "+fmtDate(fCt.done):"internal ∥ sub",bars:cbars});
    // Every document gets its lane, submitted or not. What has happened is solid; what is
    // still to come is dashed: for shop drawings the dates of the delivery cascade
    // (calcProcurement), for the others the contractual dates (theo).
    function docLane(d,key,label,sub,who){
      var l=d.cycles,last=l[l.length-1];
      var bars=cycleBars(l,who,isPurchaseDoc(d)?d.label:d.kind.toUpperCase());
      var approved=last&&(last.code==="A"||last.code==="B");
      if(!approved){
        // The main SD follows the delivery cascade; a transmission keeps its own target.
        var sdMain=d.id==="sd:_main";
        var subD=sdMain&&isValidDate(fSdS.date)?fSdS.date:d.theoSub;
        var appD=sdMain&&isValidDate(fSdA.date)?fSdA.date:d.theoApproval;
        if(!last){
          if(d.kind==="sd"&&isValidDate(ctEnd)&&isValidDate(subD)&&ctEnd<subD)
            bars.push(seg(ctEnd,subD,FLOW_COL.sub,"Forecast: sub prepares the shop drawings, submission "+fmtDate(subD),true,key+"fp"));
          if(isValidDate(subD)&&isValidDate(appD)&&subD<appD)
            bars.push(seg(subD,appD,FLOW_COL.client,"Forecast: submission "+fmtDate(subD)+" → approval "+fmtDate(appD),true,key+"fa"));
        }else if(last.submitted&&!last.code){
          var due=d.kind==="sd"?addWorkingDays(last.submitted,getDur("sdApproval")):docResponseDue(d,last.submitted);
          if(due>now)bars.push(seg(now,due,FLOW_COL.client,"Forecast: client answer expected "+fmtDate(due),true,key+"fw"));
        }
      }
      var nsub=l.length>1?l.length+" submissions":l.length?"":"not submitted";
      return {k:key,label:label,sub:[sub,nsub].filter(Boolean).join(" · "),plan:d.theoApproval,bars:bars};
    }
    docs.filter(function(d){return d.kind==="sd";}).forEach(function(d,i){
      lanes.push(docLane(d,"sd"+i,d.id==="sd:_main"?"Shop drawings":"SD "+d.label,d.id==="sd:_main"?"":d.sub,"sub"));});
    docs.filter(function(d){return d.kind==="mar"||d.kind==="mss";}).forEach(function(d,i){
      lanes.push(docLane(d,"m"+i,d.label,d.sub,"sub"));});
    docs.filter(function(d){return d.kind==="wms"||d.kind==="itp";}).forEach(function(d){
      lanes.push(docLane(d,d.kind,d.label,"","sub"));});
    docs.filter(isPurchaseDoc).forEach(function(d,i){
      lanes.push(docLane(d,"p"+i,"Purchase "+d.label,d.sub,"us"));});
    lanes.push({k:"fab",label:"Fabrication",sub:(proc.LEAD?proc.LEAD+" d lead":"")+(proc.fabStartSource?" · after "+({contract:"contract",sd:"shop drawings",material:"lead material"}[proc.fabStartSource]||proc.fabStartSource):""),bars:[seg(proc.fabStart,proc.deliveryDate,FLOW_COL.sub,"Fabrication forecast "+fmtDate(proc.fabStart||"")+" → "+fmtDate(proc.deliveryDate||""),true,"f")]});
    var weeks=[];for(var w=0;w<nW;w++)weeks.push(addCalDays(from,w*7));
    var step=nW>40?4:nW>20?2:1;
    var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var months=[];
    (function(){var y=Number(from.slice(0,4)),m=Number(from.slice(5,7));
      for(var g=0;g<40;g++){m++;if(m>12){m=1;y++;}var d=y+"-"+(m<10?"0":"")+m+"-01";if(d>addCalDays(from,span))break;
        months.push({d:d,label:MON[m-1]+" "+String(y).slice(2)});}})();
    var dl=tlDelivery(td,proc);
    return <div style={{overflowX:"auto"}}><div style={{minWidth:640}}>
      <div style={{display:"grid",gridTemplateColumns:"120px 1fr"}}>
        <span/>
        <div style={{position:"relative",height:30,fontSize:9.5,color:"#9b968b",fontFamily:"var(--font-mono,monospace)"}}>
          {months.map(function(m){return <span key={m.d} style={{position:"absolute",top:0,left:X(m.d)+"%",paddingLeft:3,borderLeft:"1px solid #c9c4b8",
            color:"#6f6b62",fontWeight:600,fontFamily:"inherit"}}>{m.label}</span>;})}
          {weeks.map(function(d,i){return i%step===0?<span key={d} style={{position:"absolute",top:15,left:(i/nW*100)+"%"}}>{d.slice(8,10)+"/"+d.slice(5,7)}</span>:null;})}
          <span style={{position:"absolute",top:15,left:X(now)+"%",transform:"translateX(-50%)",background:TL_COL.today,color:"#fff",borderRadius:3,padding:"0 4px",fontWeight:700,zIndex:4}}>today</span>
        </div>
      </div>
      <div style={{position:"relative"}}>
        <div style={{position:"absolute",left:120,right:0,top:0,bottom:0,pointerEvents:"none"}}>
          {weeks.map(function(d,i){return <span key={d} style={{position:"absolute",top:0,bottom:0,left:(i/nW*100)+"%",borderLeft:"1px solid "+(i%step===0?"#ece9e1":"#f5f3ee")}}/>;})}
          <span title={"Today "+fmtDate(now)} style={{position:"absolute",top:0,bottom:0,left:X(now)+"%",borderLeft:"2px solid "+TL_COL.today,zIndex:3}}/>
          {isValidDate(td.startOnSite)&&<span title={"Target start "+fmtDate(td.startOnSite)} style={{position:"absolute",top:-13,left:X(td.startOnSite)+"%",marginLeft:-2,zIndex:3}}><TlFlag col={TL_COL.target}/></span>}
        </div>
        {lanes.map(function(l){
          return <div key={l.k} style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",borderBottom:"1px solid #f0ede6"}}>
            <div style={{fontSize:11.5,fontWeight:600,padding:"4px 0",lineHeight:1.2}}>{l.label}{l.sub&&<div style={{fontSize:10,fontWeight:400,color:"#9b968b"}}>{l.sub}</div>}</div>
            <div style={{position:"relative",height:30}}>{planMark(l.plan)}{l.bars}
              {l.k==="fab"&&dl&&<TlDeliveryMark dl={dl} x={X(dl.date)} top={8} size={18}/>}
            </div>
          </div>;
        })}
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:10.5,color:"#6f6b62",marginTop:8}}>
        {[["With client",FLOW_COL.client],["With us",FLOW_COL.us],["With sub / bidders",FLOW_COL.sub],["Internal contract circuit",FLOW_COL.internal],["Returned",FLOW_COL.returned]].map(function(x){
          return <span key={x[0]} style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:14,height:7,borderRadius:2,background:x[1]}}/>{x[0]}</span>;})}
        <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:14,height:7,borderRadius:2,border:"1.5px dashed #6f6b62"}}/>Forecast (not done yet)</span>
        <span>┆ contractual approval (theo)</span><TlMarkerKeys/>
        {CYCLE_CODES.map(function(c){var k=FLOW_CODE_COL[c.k];return <span key={c.k} style={{display:"flex",alignItems:"center",gap:3}}><span style={{background:k[0],color:k[1],border:"1px solid "+k[1],borderRadius:3,padding:"0 4px",fontWeight:700}}>{c.k}</span>{c.label}</span>;})}
      </div>
    </div></div>;
  }

  // ---- 3. submissions: one recap line per document, its revisions open underneath ----
  // ACC / WMS / ITP revisions are edited in Submission steps (DocRevisionsEditor); this recap opens the others.
  var STATE_COL={approved:"#1e6b3a",pending:"#1a73e8",returned:"#b35c00",none:"#9b968b"};
  function recap(){
    return <div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.3fr) minmax(0,1.3fr) minmax(0,1.6fr) 60px 70px",gap:8,
        fontSize:10,color:"#9b968b",textTransform:"uppercase",letterSpacing:".06em",padding:"0 4px 4px 18px"}}>
        <span>Document</span><span>History</span><span>Now</span><span style={{textAlign:"right"}}>Days</span>
        <span style={{textAlign:"right"}} title="Real approval (or today) minus the contractual approval date: theoretical submission + client response time from Settings › Durations">VS theo</span>
      </div>
      {DOC_GROUPS.map(function(g){
        var ds=docs.filter(function(d){return d.group===g;});
        if(!ds.length){
          if(g==="Shop drawings")return <div key={g} style={{fontSize:11,color:"#9b968b",padding:"8px 0 2px 18px"}}>Shop drawings — none on this package. Tick “📐 Shop Drawing (SD)” in the Submissions tab if it has some.</div>;
          return null;
        }
        return <div key={g}>
          <div style={{fontSize:10.5,fontWeight:700,color:"#6f6b62",padding:"8px 0 2px 18px"}}>{g}</div>
          {ds.map(function(d){
            // Read-only register: every document is edited in ONE place, its own section
            // (Submission steps, WMS & ITP, Shop drawings, Materials). A click goes there.
            var s=sums[d.id];var ref=docCurRef(td,d);
            return <div key={d.id}>
              <div onClick={function(){if(onJump)onJump(d.id);}} title={onJump?"Open this document where it is edited":""}
                onMouseEnter={function(e){e.currentTarget.style.background="#f7f5f0";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}
                style={{display:"grid",gridTemplateColumns:"minmax(0,1.3fr) minmax(0,1.3fr) minmax(0,1.6fr) 60px 70px",
                gap:8,alignItems:"center",padding:"5px 4px",borderBottom:"1px solid #f0ede6",cursor:onJump?"pointer":"default",fontSize:12}}>
                <span style={{display:"flex",gap:6,alignItems:"baseline",minWidth:0}}>
                  <span style={{fontSize:10,color:"#9b968b",width:10,flex:"0 0 10px"}}>{onJump?"↗":""}</span>
                  <span style={{minWidth:0}}><b>{d.label}</b>{s.state!=="none"&&!ref&&d.id!=="sd:_main"&&<span style={{fontSize:10,fontWeight:700,color:"#c62828",marginLeft:6}}>⚠ ref. missing</span>}{d.sub&&<span style={{display:"block",fontSize:10.5,color:"#6f6b62",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.sub}{d.ref&&<span style={{fontFamily:"var(--font-mono,monospace)",marginLeft:6,color:"#9b968b"}}>{d.ref}</span>}</span>}</span>
                </span>
                <span style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap"}}>
                  {s.codes.length===0&&<span style={{color:"#ccc"}}>—</span>}
                  {s.codes.map(function(c,i){var k=FLOW_CODE_COL[c];
                    return <React.Fragment key={i}>{i>0&&<span style={{color:"#c9c4b8",fontSize:10}}>→</span>}
                      {k?<span title={"R"+i} style={{background:k[0],color:k[1],border:"1px solid "+k[1],borderRadius:4,fontSize:10,fontWeight:700,padding:"0 4px"}}>{c}</span>
                        :<span title={"R"+i+" with the client"} style={{background:"#e8f0fe",color:"#1a73e8",borderRadius:8,fontSize:10,fontWeight:700,padding:"0 6px"}}>R{i} …</span>}
                    </React.Fragment>;})}
                </span>
                <span style={{color:STATE_COL[s.state],fontWeight:s.state==="none"?400:600}}>{s.text}<OverdueTag o={s.overdue}/></span>
                <span style={{textAlign:"right",color:"#6f6b62"}}>{s.total===null?"—":s.total+" d"}</span>
                <span style={{textAlign:"right",fontWeight:700,color:s.vsTheo===null?"#c9c4b8":s.vsTheo>0?"#b3302a":"#1e6b3a"}}>
                  {s.vsTheo===null?"—":(s.vsTheo>0?"+":"")+s.vsTheo+" d"}</span>
              </div>
            </div>;
          })}
        </div>;
      })}
      <div style={{fontSize:10.5,color:"#9b968b",marginTop:6}}>Read-only register of every document of this package. Click a line to open it where it is edited (Submissions tab): its revisions, reference and codes live there, and only there.</div>
    </div>;
  }





  var dCol=delay===null?"#9b968b":delay>0?"#b3302a":"#1e6b3a";
  return <div className="card" style={{marginBottom:16}}>
    <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
      <div style={{fontWeight:700,fontSize:14}}>Flow &amp; history</div>
      <div style={{fontSize:11,color:"#9b968b"}}>every submission, return and desk, week by week</div>
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
      {chip("Resubmissions",revs,revs?"#b35c00":"#16181d","Revisions beyond R0, all documents of this tender")}
      {chip("Worst VS theo",delay===null?"—":(delay>0?"+":"")+delay+" d",dCol,"Largest gap between a contractual approval date and the real one (or today if still waiting), over every document")}
      {chip("Avg client review",_flowAvg(rv)===null?"—":_flowAvg(rv)+" d",null,"Average time a document stays with the client, per submission")}
      {chip("Avg turnaround",_flowAvg(tn)===null?"—":_flowAvg(tn)+" d",null,"Average time between a C/D return and the resubmission")}
      {chip("Contract circuit",cs.totalDays===null?"—":cs.totalDays+" d",null,"From the contract request to the signature by the subcontractor")}
    </div>
    {head("timeline","Timeline")}
    {open.timeline&&timeline()}
    {head("cycles","Submissions",<span style={{fontSize:10.5,color:"#9b968b"}}>{docs.length} documents · {docs.filter(function(d){return sums[d.id].state==="approved";}).length} approved</span>)}
    {open.cycles&&recap()}
    <div style={{fontSize:10.5,color:"#9b968b",marginTop:10}}>The contract circuit is edited in the Contract tab; the tender results (bidders) in the Submissions tab.</div>
  </div>;
}

// Read-only view of a document's latest revision, used where the old date / status fields
// were. Revisions are edited in Flow & history at the top of the tender.
function flowDocOf(td,id){return tenderDocs(td).find(function(d){return d.id===id;})||null;}
function flowDocState(td,id){var d=flowDocOf(td,id);return d?docSummary(d).state:"none";}
// Status options a user can still pick by hand: only what happens BEFORE the submission.
function flowPresubOpts(opts){return (opts||[]).filter(function(o){return !cycleCode(o)&&!/pending|submitted/i.test(o);});}
function FlowDocBadge({td,id,mode}){
  var d=flowDocOf(td,id);
  if(!d)return <span style={{color:"#ddd"}}>—</span>;
  var s=docSummary(d);var l=d.cycles;var last=l[l.length-1];
  var col={approved:"#1e6b3a",pending:"#1a73e8",returned:"#b35c00",none:"#9b968b"}[s.state];
  var tip=(id==="acc"||id==="wms"||id==="itp")?"Edit the revisions with the ▸ arrow on this row":"Edit in Flow & history → Submissions, at the top of this tender";
  if(mode==="sent"){
    if(!last||!last.submitted)return <span title={tip} style={{color:"#ccc",fontSize:11}}>—</span>;
    return <span title={tip} style={{fontSize:11,whiteSpace:"nowrap"}}>{fmtDate(last.submitted)}
      {last.rev>0&&<span style={{fontSize:9.5,color:"#b35c00",fontWeight:700,marginLeft:4}}>R{last.rev}</span>}</span>;
  }
  return <span title={tip} style={{fontSize:11,fontWeight:600,color:col,display:"inline-flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
    {s.codes.filter(Boolean).map(function(c,i){var k=FLOW_CODE_COL[c];
      return <span key={i} style={{background:k[0],color:k[1],border:"1px solid "+k[1],borderRadius:3,fontSize:9.5,padding:"0 3px"}}>{c}</span>;})}
    {s.text}<OverdueTag o={s.overdue}/></span>;
}

// The contract next to the documents: green signed by the sub, blue under way
// (request sent or in circulation), dashed not started.
function tenderContractPill(td){
  if(td.cancelled)return {st:"none",tip:"Contract: package cancelled"};
  if(tenderPhase(td)==="sig"){
    var c=(td.stepDates||{}).contract||{},d=c.signedAllDone||c.signedDone||"";
    return {st:"approved",tip:"Contract signed"+(isValidDate(d)?" "+fmtDate(d):"")};
  }
  var cs=(function(){try{return circuitState(circuitOf(td));}catch(e){return null;}})();
  var ct=(td.stepDates||{}).contract||{};
  if((cs&&cs.started)||ct.requestDone||ct.circulateDone){
    var at=cs&&cs.current.length?cs.current.map(function(x){return x.stage.label;}).join(" / "):"";
    return {st:"pending",tip:"Contract under way"+(at?" · "+at:"")+(cs&&cs.started?" · since "+fmtDate(cs.started):"")};
  }
  return {st:"none",tip:"Contract: not started"};
}
// One pill per kind of document, for the tenders list: colour = where it stands,
// a/n = approved out of n when there are several, small number = highest revision.
function FlowDocDots({td}){
  var docs=tenderDocs(td);
  var KINDS=[["acc","ACC"],["ctr","Contract"],["sd","SD"],["mar","MAR"],["mss","MSS"],["wms","WMS"],["itp","ITP"],["kom","Kick off"]];
  var PILL={approved:["#e8f5e9","#1e6b3a"],pending:["#e8f0fe","#1a73e8"],returned:["#fff3e0","#b35c00"],none:["#f5f3ee","#9b968b"]};
  var pillStyle=function(st){var cc=PILL[st];return {background:cc[0],color:cc[1],border:st==="none"?"1px dashed #c9c4b8":"1px solid "+cc[1]+"55",
    borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px",whiteSpace:"nowrap",cursor:"help"};};
  return <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{KINDS.map(function(k){
    if(k[0]==="kom"){
      var ks=kickoffState(td),ksd=((td.stepDates||{}).kickoff)||{};
      var ktip=ks==="na"?"Kick off meeting: N/A":ks==="held"?"Kick off meeting held"+(ksd.done?" "+fmtDate(ksd.done):""):
        ks==="planned"?"Kick off meeting planned"+(ksd.target?" "+fmtDate(ksd.target):""):"Kick off meeting: not planned";
      return <span key="kom" title={ktip} style={pillStyle(ks==="na"||ks==="held"?"approved":ks==="planned"?"pending":"none")}>{ks==="na"?"Kick off N/A":"Kick off"}</span>;
    }
    // A WMS or ITP set to N/A has nothing left to do: green, like an approved one.
    if((k[0]==="wms"||k[0]==="itp")&&((td.steps||{})[k[0]]||"")==="N/A")
      return <span key={k[0]} title={k[1]+": N/A"} style={pillStyle("approved")}>{k[1]} N/A</span>;
    if(k[0]==="ctr"){
      var cp=tenderContractPill(td),cc=PILL[cp.st];
      return <span key="ctr" title={cp.tip} style={{background:cc[0],color:cc[1],border:cp.st==="none"?"1px dashed #c9c4b8":"1px solid "+cc[1]+"55",
        borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px",whiteSpace:"nowrap",cursor:"help"}}>Contract</span>;
    }
    var ds=docs.filter(function(d){return d.kind===k[0];});
    if(!ds.length&&(k[0]==="sd"||k[0]==="mar"||k[0]==="mss"))return null;
    var sm=ds.map(function(d){return docSummary(d);});
    var ok=sm.filter(function(x){return x.state==="approved";}).length;
    var st=!sm.length?"none":ok===sm.length?"approved":sm.some(function(x){return x.state==="returned";})?"returned":
      sm.some(function(x){return x.state==="pending";})?"pending":"none";
    var rev=sm.reduce(function(m,x){return x.rev!==null&&x.rev>m?x.rev:m;},0);
    var c={approved:["#e8f5e9","#1e6b3a"],pending:["#e8f0fe","#1a73e8"],returned:["#fff3e0","#b35c00"],none:["#f5f3ee","#9b968b"]}[st];
    var tip=ds.map(function(d,i){return d.label+(d.sub&&d.kind!=="acc"?" "+d.sub:"")+": "+sm[i].text;}).join("\n")||k[1]+": not submitted";
    return <span key={k[0]} title={tip} style={{background:c[0],color:c[1],border:st==="none"?"1px dashed #c9c4b8":"1px solid "+c[1]+"55",
      borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px",whiteSpace:"nowrap",cursor:"help"}}>
      {k[1]}{sm.length>1?" "+ok+"/"+sm.length:""}{rev>0&&<sup style={{fontSize:8,marginLeft:1}}>R{rev}</sup>}</span>;
  })}</div>;
}

// Colour key for the Submissions pills of the tenders list.
function FlowDocLegend(){
  var items=[
    ["#e8f5e9","#1e6b3a","solid","Approved","code A or B"],
    ["#e8f0fe","#1a73e8","solid","With the client","submitted, waiting for the answer"],
    ["#fff3e0","#b35c00","solid","To resubmit","returned C or D"],
    ["#f5f3ee","#9b968b","dashed","Not submitted",""]
  ];
  return <div className="phone-hide" style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",fontSize:11,color:"#6f6b62",margin:"0 0 8px",padding:"6px 10px",background:"#fafaf8",border:"1px solid #ece9e1",borderRadius:8}}>
    <span style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#9b968b"}}>Submissions</span>
    {items.map(function(x){
      return <span key={x[3]} style={{display:"flex",alignItems:"center",gap:5}}>
        <span style={{background:x[0],color:x[1],border:x[2]==="dashed"?"1px dashed #c9c4b8":"1px solid "+x[1]+"55",borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px"}}>ACC</span>
        <b style={{fontWeight:600,color:"#16181d"}}>{x[3]}</b>{x[4]&&<span style={{color:"#9b968b"}}>{x[4]}</span>}
      </span>;
    })}
    <span style={{display:"flex",alignItems:"center",gap:5}}>
      <span style={{background:"#e8f5e9",color:"#1e6b3a",border:"1px solid #1e6b3a55",borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px"}}>Contract</span>
      <span style={{background:"#e8f0fe",color:"#1a73e8",border:"1px solid #1a73e855",borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px"}}>Contract</span>
      <span style={{color:"#9b968b"}}>signed / under way (dashed: not started)</span>
    </span>
    <span style={{display:"flex",alignItems:"center",gap:5}}>
      <span style={{background:"#e8f5e9",color:"#1e6b3a",border:"1px solid #1e6b3a55",borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px"}}>SD 1/3</span>
      <span style={{color:"#9b968b"}}>approved / total</span>
    </span>
    <span style={{display:"flex",alignItems:"center",gap:5}}>
      <span style={{background:"#fff3e0",color:"#b35c00",border:"1px solid #b35c0055",borderRadius:4,fontSize:10,fontWeight:700,padding:"0 5px"}}>MAR<sup style={{fontSize:8,marginLeft:1}}>R2</sup></span>
      <span style={{color:"#9b968b"}}>highest revision</span>
    </span>
    <span style={{color:"#9b968b",marginLeft:"auto"}}>Hover a pill for the detail of each document</span>
  </div>;
}

// ---------------------------------------------------------------------------
// Tenders list: phase of each tender, what is happening now, and the mini timeline.
// ---------------------------------------------------------------------------
var TENDER_PHASES=[
  {k:"pre",label:"Before client approval",short:"Before approval",bg:"#f3e5f5",fg:"#6a1b9a"},
  {k:"ctr",label:"Approved · contract phase",short:"Contract phase",bg:"#fff3e0",fg:"#b35c00"},
  {k:"sig",label:"Contract signed",short:"Signed",bg:"#e8f5e9",fg:"#1e6b3a"},
  {k:"can",label:"Cancelled",short:"Cancelled",bg:"#f5f3ee",fg:"#9b968b"}
];
//   pre = the ACC/Aconex has no A/B yet
//   ctr = ACC approved, the subcontractor has not signed yet
//   sig = signed by the subcontractor (last stage of the contract circuit; for contracts
//         not tracked in the circuit, the old Contract signed dates count, as for the row colour)
function tenderPhase(td){
  if(td.cancelled)return"can";
  var ct=(td.stepDates||{}).contract||{};
  var signed=td.contractCircuit?!!ct.signedAllDone:!!(ct.signedAllDone||ct.signedDone||/signed/i.test((td.steps||{}).contract||""));
  if(signed)return"sig";
  var acc=cyclesOfStep(td,"acc");var last=acc[acc.length-1];
  if(last&&(last.code==="A"||last.code==="B"))return"ctr";
  // Internal approval only (below the ACC threshold): the contract starts once a bidder is awarded.
  if(!acc.length&&tenderApprovalRoute(td).route==="none"&&(ct.requestDone||biddersOf(td).some(function(b){return b.result==="awarded";})))return"ctr";
  return"pre";
}
var TENDER_PHASE_ORDER={pre:0,ctr:1,sig:2,can:3};
function tenderContractStage(t){var c=(t.stepDates||{}).contract||{};if(c.signedDone||c.signedAllDone)return 4;if(c.circulateDone)return 3;if(c.requestDone)return 2;if(((t.stepDates||{}).acc||{}).approval)return 1;return 0;}
// Progress of a step value, for sorting: nothing / not done < not started < under way < approved; N/A last.
function tenderStepRank(step,val){
  var c=tenderStepClass(step,val||"");
  if(val==="N/A")return 5;
  if(c==="s-notdone"||!val||val==="—")return 0;
  if(c==="s-approved-a")return 4;
  if(/approved b/i.test(val))return 3;
  if(c==="s-pending")return 2;
  return 1;
}
// One line: the step in progress, who holds it, for how long.
// who: us | client | sub | internal
function tenderNow(td,now){
  now=now||today();
  function since(d){return isValidDate(d)?Math.round((new Date(now)-new Date(d))/86400000):null;}
  var ph=tenderPhase(td);
  if(ph==="can")return {text:"Cancelled",who:"us",days:null};
  var docs=tenderDocs(td);
  var sums=docs.map(function(d){return {d:d,s:docSummary(d,now)};});
  function docLine(x){
    var l=x.d.cycles,last=l[l.length-1];
    var name=docShortName(x.d);
    if(x.s.state==="pending")return {text:name+" R"+last.rev+" · with client",who:"client",days:since(last.submitted),overdue:x.s.overdue};
    return {text:name+" · to resubmit ("+last.code+")",who:docAccClock(x.d.kind)?"us":"sub",days:since(last.returned)};
  }
  var acc=sums.find(function(x){return x.d.id==="acc";});
  if(ph==="pre"){
    if(acc&&(acc.s.state==="pending"||acc.s.state==="returned"))return docLine(acc);
    // A package with purchases and no tender out yet: the purchase waiting on someone.
    var pOpen=sums.filter(function(x){return isPurchaseDoc(x.d)&&(x.s.state==="pending"||x.s.state==="returned");});
    if(pOpen.length&&!td.tenderIssued)return docLine(pOpen[0]);
    if(td.tenderIssued&&!td.bidsReceived)return {text:"Tender out · bidders pricing",who:"sub",days:since(td.tenderIssued)};
    if(td.bidsReceived)return {text:"Bid evaluation · "+(tenderApprovalRoute(td).route==="none"?"internal approval":tenderRouteLabel(td)+" to submit"),who:"us",days:since(td.bidsReceived)};
    return {text:"Tender preparation",who:"us",days:null};
  }
  if(ph==="ctr"){
    var cs=circuitState(circuitOf(td),now);
    if(cs.current.length){
      return {text:"Contract · "+cs.current.map(function(x){return x.stage.label.replace(/^Circulation to /,"");}).join(" / "),
        who:cs.current.some(function(x){return x.stage.branch==="internal";})?"internal":cs.current[0].stage.branch==="sub"?"sub":"us",
        days:Math.max.apply(null,cs.current.map(function(x){return since(x.since)||0;}))};
    }
    return {text:"Contract · request to send",who:"us",days:since((acc&&acc.s.stats.approvedOn)||"")};
  }
  // signed: first open document, then fabrication
  var open=sums.filter(function(x){return x.s.state==="pending"||x.s.state==="returned";})
    .sort(function(a,b){return (a.s.state==="returned"?0:1)-(b.s.state==="returned"?0:1);});
  if(open.length)return docLine(open[0]);
  var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
  if(isValidDate(proc.deliveryDate)&&proc.deliveryDate<=now)return {text:"Delivered (forecast date passed)",who:"sub",days:null};
  if(isValidDate(proc.fabStart)&&proc.fabStart<=now)return {text:"Fabrication",who:"sub",days:since(proc.fabStart)};
  var waiting=sums.filter(function(x){return x.s.state==="none";});
  if(waiting.length)return {text:waiting.length+" document"+(waiting.length>1?"s":"")+" to submit",who:"sub",days:null};
  return {text:"Waiting for fabrication",who:"sub",days:null};
}
// Stage column of the list: where the package is now (tenderNow) and the step that comes
// after it. Computed only from the dates and statuses already entered, never typed.
// The free-text "Next Step" of the Follow-up column stays the team's own comment.
var STAGE_WHO_COL={us:"#6f6b62",client:"#1a73e8",sub:"#7b1fa2",internal:"#d85a30"};
var STAGE_WHO_LABEL={us:"Us",client:"Client",sub:"Subcontractor",internal:"Internal"};
function tenderStage(td,now){
  now=now||today();
  var cur=Object.assign({},tenderNow(td,now));
  var ph=tenderPhase(td);
  if(ph==="can")return Object.assign(cur,{next:""});
  var sums=tenderDocs(td).map(function(d){return {d:d,s:docSummary(d,now)};});
  function name(d){return docShortName(d);}
  var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
  function fab(){return "Fabrication"+(isValidDate(proc.fabStart)?" · "+fmtDate(proc.fabStart):"");}
  var next="";
  if(ph==="pre"){
    var acc=sums.find(function(x){return x.d.id==="acc";});
    var st=acc?acc.s.state:"none",val=String((td.steps||{}).acc||"");
    var RL=tenderRouteLabel(td),internal=tenderApprovalRoute(td).route==="none";
    if(st==="pending")next=RL+" approved → contract request";
    else if(st==="returned")next=RL+" · with client";
    else if(internal&&td.bidsReceived)next="Award (internal approval) → contract request";
    else if(/internal review/i.test(val)){cur={text:RL+" · internal review",who:"internal",days:null};next=RL+" · with client";}
    else if(/under preparation/i.test(val)){cur={text:RL+" · under preparation",who:"us",days:null};next=RL+" · internal review";}
    else if(td.tenderIssued&&!td.bidsReceived)next="Bid evaluation";
    else if(td.bidsReceived)next=RL+" · with client";
    else next="Tender out to bidders";
  }else if(ph==="ctr"){
    var cs=circuitState(circuitOf(td),now);
    var lbl=function(x){
      var s=x.stage,b=s.branch;
      if(b==="start")return "Contract · request to contract dept";
      if(b==="internal")return "Contract · internal ("+s.label.replace(/^Circulation to /,"")+")";
      if(b==="sub")return "Contract · with sub ("+s.label+")";
      return "Contract · "+s.label;
    };
    var open=cs.stages.filter(function(x){return x.state!=="done";});
    if(cs.current.length){
      cur.text=cs.current.map(lbl).join(" / ");
      var last=Math.max.apply(null,cs.current.map(function(x){return cs.stages.indexOf(x);}));
      var n=open.find(function(x){return cs.stages.indexOf(x)>last;});
      next=n?lbl(n):"Shop drawings / documents";
    }else{
      if(open[0]&&open[0].stage.branch!=="start")cur.text=lbl(open[0])+" · to send";
      next=open[1]?lbl(open[1]):"Shop drawings / documents";
    }
  }else{
    var opened=sums.filter(function(x){return x.s.state==="pending"||x.s.state==="returned";})
      .sort(function(a,b){return (a.s.state==="returned"?0:1)-(b.s.state==="returned"?0:1);});
    var waiting=sums.filter(function(x){return x.s.state==="none";});
    if(opened.length){
      var o=opened[0];
      if(o.s.state==="returned")next=name(o.d)+" · with client";
      else if(opened[1])next=name(opened[1].d)+(opened[1].s.state==="returned"?" · to resubmit":" · client answer");
      else if(waiting.length)next=name(waiting[0].d)+" · to submit";
      else next=fab();
    }else if(isValidDate(proc.deliveryDate)&&proc.deliveryDate<=now)next="";
    else if(isValidDate(proc.fabStart)&&proc.fabStart<=now)next="Delivery · "+fmtDate(proc.deliveryDate||"");
    else if(waiting.length)next=name(waiting[0].d)+" · with client";
    else next=fab();
  }
  return Object.assign(cur,{next:next});
}
function TenderStageCell({td}){
  var s=tenderStage(td);
  var col=STAGE_WHO_COL[s.who]||STAGE_WHO_COL.us;
  return <div style={{minWidth:170,fontSize:11,lineHeight:1.35}}>
    <div style={{display:"flex",alignItems:"baseline",gap:5}} title={"Held by: "+(STAGE_WHO_LABEL[s.who]||"Us")}>
      <span style={{width:8,height:8,borderRadius:"50%",background:col,flexShrink:0,display:"inline-block",transform:"translateY(-1px)"}}/>
      <span style={{color:col,fontWeight:700}}>{s.text}{s.days!==null&&s.days>=0?<span style={{fontWeight:400,color:"#9b968b"}}>{" · "+s.days+" d"}</span>:null}<OverdueTag o={s.overdue}/></span>
    </div>
    {s.next&&<div style={{color:"#6f6b62",marginLeft:13}}><span style={{fontSize:9.5,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#9b968b"}}>Next </span>{s.next}</div>}
  </div>;
}
// Quick filters of the tenders list.
function tenderQuick(td,k){
  if(k==="na")return !(td.awards||[]).some(function(a){return a.subcontractor;});
  if(k==="cl")return tenderDocs(td).some(function(d){return docSummary(d).state==="pending";});
  if(k==="late"){var p=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
    return isValidDate(p.deliveryDate)&&isValidDate(td.startOnSite)&&p.deliveryDate>td.startOnSite;}
  return true;
}
// Common date range for every mini timeline of the list, so rows compare.
function tenderListRange(list,now){
  now=now||today();
  var ds=[now];
  list.forEach(function(td){
    if(td.cancelled)return;
    // Only what the rows draw: the ACC approval and contract marks, the target start, the delivery.
    if(isValidDate(td.startOnSite))ds.push(td.startOnSite);
    var p=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
    (p.steps||[]).forEach(function(x){if((x.key==="accApp"||x.key==="contract")&&isValidDate(x.done||x.date))ds.push(x.done||x.date);});
    if(isValidDate(p.deliveryDate))ds.push(p.deliveryDate);
  });
  ds.sort();
  var from=addCalDays(ds[0],-7),to=addCalDays(ds[ds.length-1],14);
  // keep it readable: no more than ~18 months
  if((new Date(to)-new Date(from))/86400000>550)from=addCalDays(to,-550);
  return {from:from,to:to};
}
// ---------------------------------------------------------------------------
// Timeline markers — one colour per meaning, shared by the tenders list and the
// tender's Flow & history panel, so a symbol never changes colour between views.
//   today   ink line            target start  grey flag
//   new starting date (= delivery forecast): green truck if on or before the target
//   start, red truck if after it, grey if there is no target start to compare with.
//   The gap in days sits next to it, in the same colour.
// ---------------------------------------------------------------------------
const TL_COL={today:"#14171c",target:"#6f6b62",early:"#2e7d32",late:"#c62828",unknown:"#9b968b"};
function tlDayGap(a,b){return Math.round((new Date(a+"T00:00:00")-new Date(b+"T00:00:00"))/86400000);}
function tlDelivery(td,proc){
  var d=proc&&proc.deliveryDate;if(!isValidDate(d))return null;
  var t=td&&td.startOnSite;
  if(!isValidDate(t))return {date:d,gap:null,col:TL_COL.unknown,label:"",tip:"New starting date "+fmtDate(d)+" — no target start to compare with"};
  var g=tlDayGap(d,t);
  var label=(g>0?"+":g<0?"\u2212":"\u00b1")+Math.abs(g)+" d";
  return {date:d,gap:g,col:g>0?TL_COL.late:TL_COL.early,label:label,
    tip:"New starting date "+fmtDate(d)+" — "+(g>0?label+" after":g<0?Math.abs(g)+" d before":"same day as")+" the target start "+fmtDate(t)};
}
function TlTruck({col,size}){
  var w=size||16;
  return <svg width={w} height={w*0.75} viewBox="0 0 16 12" style={{display:"block",flexShrink:0}} aria-hidden="true">
    <path d="M0.5 1.5h9.5v6.5H0.5z M10 3.8h3.2l2.3 2.7v1.5H10z" fill={col}/>
    <circle cx="3.8" cy="9.6" r="1.7" fill={col} stroke="#fff" strokeWidth="0.9"/>
    <circle cx="12.2" cy="9.6" r="1.7" fill={col} stroke="#fff" strokeWidth="0.9"/>
  </svg>;
}
function TlFlag({col,size}){
  var w=size||12;
  return <svg width={w} height={w} viewBox="0 0 12 12" style={{display:"block",flexShrink:0}} aria-hidden="true">
    <path d="M2 0.8v10.6" stroke={col} strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M2.7 1.2h7.6l-2.2 2.4 2.2 2.4H2.7z" fill={col}/>
  </svg>;
}
// Truck + gap, anchored on the delivery date. Near the right edge the gap goes to the left.
function TlDeliveryMark({dl,x,top,size}){
  var right=x>86;
  return <span title={dl.tip} style={{position:"absolute",top:top||0,left:x+"%",zIndex:3,display:"flex",alignItems:"center",gap:2,whiteSpace:"nowrap",
      flexDirection:right?"row-reverse":"row",transform:right?"translateX(calc(-100% + "+((size||16)/2)+"px))":"translateX(-"+((size||16)/2)+"px)"}}>
    <TlTruck col={dl.col} size={size}/>
    {dl.gap!==null&&<span style={{fontSize:9.5,fontWeight:700,color:dl.col,background:"rgba(255,255,255,.9)",borderRadius:3,padding:"0 3px",lineHeight:"12px"}}>{dl.label}</span>}
  </span>;
}
// The three marker keys, identical wherever a timeline is drawn.
function TlMarkerKeys(){
  var it={display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"};
  return <React.Fragment>
    <span style={it}><span style={{width:0,height:12,borderLeft:"2px solid "+TL_COL.today}}/>Today</span>
    <span style={it}><TlFlag col={TL_COL.target}/>Target start</span>
    <span style={it}><TlTruck col={TL_COL.early}/><span style={{color:TL_COL.early,fontWeight:700}}>−5 d</span>New starting date before target</span>
    <span style={it}><TlTruck col={TL_COL.late}/><span style={{color:TL_COL.late,fontWeight:700}}>+12 d</span>after target</span>
    <span style={it}><TlTruck col={TL_COL.unknown}/>no target start</span>
  </React.Fragment>;
}
function TenderTimelineLegend(){
  var it={display:"flex",alignItems:"center",gap:4};
  return <div className="phone-hide" style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",fontSize:11,color:"#6f6b62",margin:"0 0 8px",padding:"6px 10px",background:"#fafaf8",border:"1px solid #ece9e1",borderRadius:8}}>
    <span style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#9b968b"}}>Timeline</span>
    <TlMarkerKeys/>
    <span style={it}><span style={{width:9,height:9,borderRadius:"50%",background:FLOW_COL.client}}/>ACC/Aconex approved</span>
    <span style={it}><span style={{width:7,height:7,transform:"rotate(45deg)",background:FLOW_COL.internal}}/>Contract signed</span>
    <span style={it}><span style={{width:9,height:9,borderRadius:"50%",border:"1.5px solid #9b968b"}}/>hollow = expected</span>
    <span style={it}><span style={{width:14,height:6,borderRadius:2,border:"1px dashed "+FLOW_COL.sub}}/>Sub: shop drawings / fabrication</span>
    <span style={it}><span style={{width:14,height:6,borderRadius:2,border:"1px dashed "+FLOW_COL.client}}/>Shop drawings with the client</span>
  </div>;
}
// Today as one continuous line over the whole list. It is measured from the scale row
// (data-tl-scale) so it lands exactly where the mini timelines put today.
function tlRailPos(wrap,range){
  var sc=wrap.querySelector("[data-tl-scale]"),tbs=wrap.querySelectorAll("tbody"),tb=tbs[tbs.length-1];
  if(!sc||!tb)return null;
  var w=wrap.getBoundingClientRect(),r=sc.getBoundingClientRect(),b=tb.getBoundingClientRect();
  var span=Math.max(1,tlDayGap(range.to,range.from));
  var f=Math.max(0,Math.min(1,tlDayGap(today(),range.from)/span));
  return {left:Math.round(r.left-w.left+f*r.width),top:Math.round(r.top-w.top),height:Math.round(b.bottom-r.top)};
}
function TenderTodayRail({range,dep}){
  const ref=useRef(null);
  const [pos,setPos]=useState(null);
  React.useLayoutEffect(function(){
    var el=ref.current;if(!el)return;
    var wrap=el.parentNode;
    function measure(){
      var p=tlRailPos(wrap,range);
      if(!p){setPos(null);return;}
      setPos(function(o){return o&&o.left===p.left&&o.top===p.top&&o.height===p.height?o:p;});
    }
    measure();
    var ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;
    if(ro)ro.observe(wrap);
    window.addEventListener("resize",measure);
    return function(){if(ro)ro.disconnect();window.removeEventListener("resize",measure);};
  },[range.from,range.to,dep]);
  return <div ref={ref} className="phone-hide tp-tl" data-from={range.from} data-to={range.to} style={{position:"absolute",left:0,top:0,width:0,height:0,pointerEvents:"none"}}>
    {pos&&<div data-tl-rail="1" title={"Today "+fmtDate(today())} style={{position:"absolute",left:pos.left,top:pos.top,height:pos.height,borderLeft:"2px solid "+TL_COL.today,zIndex:4}}>
      <span style={{position:"absolute",top:-1,left:0,transform:"translateX(-50%)",background:TL_COL.today,color:"#fff",fontSize:9,fontWeight:700,
        letterSpacing:".04em",borderRadius:3,padding:"0 5px",lineHeight:"13px",whiteSpace:"nowrap"}}>TODAY {fmtDate(today())}</span>
    </div>}
  </div>;
}
// One row of the tenders list. On purpose it shows very little:
//   past    only two marks: the ACC/Aconex approval and the contract signature
//   future  the shop-drawing circuit still to come (sub preparing → submission → client
//           answer, and the resubmission after a C / D), then the fabrication with the truck
// Everything before today is cut off, except those two marks. The full history stays in the
// tender's Flow & history panel.
function TenderMiniTimeline({td,range}){
  var now=today();
  var span=Math.max(1,(new Date(range.to)-new Date(range.from))/86400000);
  function X(d){return Math.max(0,Math.min(100,(new Date(d)-new Date(range.from))/86400000/span*100));}
  var out=[];var k=0;
  // A forecast bar, clipped at today: only the part still to come is drawn.
  function fut(a,b,col,tip){
    if(!isValidDate(a)||!isValidDate(b))return;
    var s=a<now?now:a;if(b<=s)return;
    out.push(<div key={"f"+(k++)} title={tip} style={{position:"absolute",top:5,height:6,borderRadius:2,left:X(s)+"%",width:Math.max(0.4,X(b)-X(s))+"%",
      border:"1px dashed "+col,background:"transparent"}}/>);
  }
  var p=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
  function pst(key){return (p.steps||[]).find(function(x){return x.key===key;})||{};}
  var fAcc=pst("accApp"),fCt=pst("contract"),fSdS=pst("sdSub"),fSdA=pst("sdApp");
  var accDone=fAcc.done||"",ctDone=fCt.done||"";
  var ctEnd=ctDone||fCt.date;
  // --- the two past marks (also shown, hollow, while they are still forecasts)
  function mark(d,done,shape,col,tip){
    if(!isValidDate(d)||d<range.from)return;
    var sz=shape==="diamond"?8:9;
    out.push(<div key={"m"+(k++)} title={tip} style={{position:"absolute",top:shape==="diamond"?3:2.5,left:X(d)+"%",marginLeft:-sz/2,width:sz,height:sz,zIndex:2,
      borderRadius:shape==="diamond"?1:"50%",transform:shape==="diamond"?"rotate(45deg)":"none",
      background:done?col:"#fff",border:(done?"1px solid #fff":"1.5px solid "+col)}}/>);
  }
  mark(accDone||fAcc.date,!!accDone,"circle",FLOW_COL.client,accDone?"ACC/Aconex approved "+fmtDate(accDone):"ACC/Aconex approval expected "+fmtDate(fAcc.date));
  mark(ctEnd,!!ctDone,"diamond",FLOW_COL.internal,ctDone?"Contract signed "+fmtDate(ctDone):"Contract signing expected "+fmtDate(fCt.date));
  // --- shop drawings still to come
  tenderDocs(td).filter(function(d){return d.kind==="sd";}).forEach(function(d){
    var l=d.cycles||[],last=l[l.length-1],name=d.id==="sd:_main"?"SD":"SD "+d.label,main=d.id==="sd:_main";
    if(last&&(last.code==="A"||last.code==="B"))return;               // approved: nothing to come
    if(!last){
      var subD=main&&isValidDate(fSdS.date)?fSdS.date:d.theoSub;
      var appD=main&&isValidDate(fSdA.date)?fSdA.date:d.theoApproval;
      if(isValidDate(ctEnd)&&isValidDate(subD)&&ctEnd<subD)fut(ctEnd,subD,FLOW_COL.sub,"Forecast: sub prepares the "+name+", submission "+fmtDate(subD));
      fut(subD,appD,FLOW_COL.client,"Forecast: "+name+" with the client "+fmtDate(subD)+" → approval "+fmtDate(appD));
    }else if(isValidDate(last.submitted)&&!last.code){
      // the main SD follows the delivery cascade, so its answer date matches the truck
      var due=main&&isValidDate(fSdA.date)?fSdA.date:addWorkingDays(last.submitted,getDur("sdApproval"));
      fut(now,due>now?due:addWorkingDays(now,1),FLOW_COL.client,name+" R"+last.rev+" with the client since "+fmtDate(last.submitted)+" — answer expected "+fmtDate(due));
    }else if(main&&isValidDate(pst("sdReappBack").date)){
      var rb=pst("sdResubBack"),ab=pst("sdReappBack");
      fut(isValidDate(last.returned)?last.returned:now,rb.date,FLOW_COL.sub,"Forecast: sub reworks the "+name+" (returned "+last.code+"), resubmission "+fmtDate(rb.date));
      fut(rb.date,ab.date,FLOW_COL.client,"Forecast: "+name+" R"+(last.rev+1)+" with the client → approval "+fmtDate(ab.date));
    }else if(last.code==="C"||last.code==="D"){
      var from=isValidDate(last.returned)?last.returned:now;
      var resub=addWorkingDays(from>now?from:now,14);
      var reapp=addWorkingDays(resub,getDur("sdApproval"));
      fut(from,resub,FLOW_COL.sub,"Forecast: sub reworks the "+name+" (returned "+last.code+"), resubmission "+fmtDate(resub));
      fut(resub,reapp,FLOW_COL.client,"Forecast: "+name+" R"+(last.rev+1)+" with the client → approval "+fmtDate(reapp));
    }
  });
  // --- fabrication and delivery
  fut(p.fabStart,p.deliveryDate,FLOW_COL.sub,"Fabrication forecast "+fmtDate(p.fabStart||"")+" → "+fmtDate(p.deliveryDate||""));
  var dl=tlDelivery(td,p);
  return <div style={{position:"relative",height:15,margin:"2px 0"}}>
    <span style={{position:"absolute",left:0,right:0,top:7,height:1,background:"#ece9e1"}}/>
    {out}
    {isValidDate(td.startOnSite)&&<span title={"Target start "+fmtDate(td.startOnSite)} style={{position:"absolute",top:1,left:X(td.startOnSite)+"%",marginLeft:-2,zIndex:3}}><TlFlag col={TL_COL.target}/></span>}
    {dl&&<TlDeliveryMark dl={dl} x={X(dl.date)} top={1.5}/>}
  </div>;
}
function TenderMiniScale({range}){
  var span=Math.max(1,(new Date(range.to)-new Date(range.from))/86400000);
  var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var ms=[];var y=Number(range.from.slice(0,4)),m=Number(range.from.slice(5,7));
  for(var g=0;g<24;g++){m++;if(m>12){m=1;y++;}var d=y+"-"+(m<10?"0":"")+m+"-01";if(d>range.to)break;ms.push({d:d,l:MON[m-1]+(m===1||g===0?" "+String(y).slice(2):"")});}
  var step=ms.length>12?2:1;
  return <div data-tl-scale="1" style={{position:"relative",height:13,fontSize:9.5,color:"#9b968b"}}>
    {ms.map(function(x,i){return i%step===0?<span key={x.d} style={{position:"absolute",left:((new Date(x.d)-new Date(range.from))/86400000/span*100)+"%",borderLeft:"1px solid #d9d5ca",paddingLeft:2}}>{x.l}</span>:null;})}
  </div>;
}

// ---------------------------------------------------------------------------
// ProcFlowView — "Procurement flow": every tender placed on a board, one row per package,
// one column per stage. Click a card to see its tender results, its contract circuit and
// its documents underneath; "Open tender" goes to the full sheet.
// ---------------------------------------------------------------------------
var PF_COLS=[
  {k:0,label:"Tender",tip:"Tender being prepared, or out to bidders"},
  {k:1,label:"Tender result",tip:"Bids received, evaluation and ACC/Aconex to submit"},
  {k:2,label:"ACC/Aconex",tip:"Tender result submitted to the client, not approved yet"},
  {k:3,label:"Contract",tip:"ACC approved, contract in circulation, not signed by the sub yet"},
  {k:4,label:"Documents",tip:"Contract signed; shop drawings, MAR, MSS, WMS or ITP still open"},
  {k:5,label:"Fab · delivery",tip:"Every document approved: fabrication and delivery"}
];
function procFlowCol(td){
  var ph=tenderPhase(td);
  if(ph==="ctr")return 3;
  if(ph==="sig"){
    var open=tenderDocs(td).some(function(d){return d.kind!=="acc"&&docSummary(d).state!=="approved";});
    return open?4:5;
  }
  var acc=cyclesOfStep(td,"acc");
  if(acc.length&&acc[acc.length-1].submitted)return 2;
  if(td.bidsReceived||biddersOf(td).some(function(b){return Number(b.price)>0;}))return 1;
  return 0;
}
function ProcFlowView({tenders,onNavTender}){
  const [selId,setSelId]=useState("");
  const [q,setQ]=useState("");
  var now=today();
  var list=(tenders||[]).filter(function(t){
    if(t.cancelled)return false;
    if(!q)return true;
    var s=q.toLowerCase();
    return (t.title||"").toLowerCase().includes(s)||(t.package||"").toLowerCase().includes(s)||
      (t.awards||[]).some(function(a){return (a.subcontractor||"").toLowerCase().includes(s);});
  });
  var info={};list.forEach(function(t){
    var p=(function(){try{return calcProcurement(t);}catch(e){return{};}})();
    info[t.id]={col:procFlowCol(t),now:tenderNow(t,now),
      revs:tenderDocs(t).reduce(function(n,d){return n+Math.max(0,d.cycles.length-1);},0),
      late:isValidDate(p.deliveryDate)&&isValidDate(t.startOnSite)&&p.deliveryDate>t.startOnSite};
  });
  var pkgs=[...new Set(list.map(function(t){return t.package||"—";}))].sort(function(a,b){return a==="—"?1:b==="—"?-1:a.localeCompare(b);});
  var counts=PF_COLS.map(function(c){return list.filter(function(t){return info[t.id].col===c.k;}).length;});
  var sel=list.find(function(t){return t.id===selId;})||null;
  var whoCol={us:"#6f6b62",client:"#1a73e8",sub:"#7b1fa2",internal:"#d85a30"};
  var whoBg={us:"#f5f3ee",client:"#e8f0fe",sub:"#f3e5f5",internal:"#fbe9e7"};

  function card(t){
    var x=info[t.id];var aw=(t.awards||[]).filter(function(a){return a.subcontractor;});
    var on=t.id===selId;
    return <div key={t.id} onClick={function(){setSelId(on?"":t.id);}} title={t.title}
      style={{border:on?"2px solid #1a73e8":"1px solid #d9d5ca",borderRadius:8,padding:on?"4px 6px":"5px 7px",marginBottom:5,
        background:"#fff",cursor:"pointer",fontSize:11,lineHeight:1.35}}>
      <div style={{fontWeight:700,fontSize:11.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title||"(untitled)"}</div>
      <div style={{color:aw.length?"#1e6b3a":"#9b968b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {aw.length?"🏆 "+aw.map(function(a){return a.subcontractor;}).join(", "):"not awarded"}</div>
      <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:3,alignItems:"center"}}>
        <span style={{background:whoBg[x.now.who]||"#f5f3ee",color:whoCol[x.now.who]||"#6f6b62",borderRadius:8,padding:"0 6px",fontSize:10,fontWeight:600,
          maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={x.now.text}>
          {x.now.text.replace(/ · with client$/,"")}{x.now.days!==null&&x.now.days>=0?" · "+x.now.days+"d":""}<OverdueTag o={x.now.overdue}/></span>
        {x.revs>0&&<span style={{background:"#fff3e0",color:"#b35c00",borderRadius:8,padding:"0 5px",fontSize:10,fontWeight:700}}>R{x.revs}</span>}
        {x.late&&<span style={{background:"#fce4ec",color:"#b3302a",borderRadius:8,padding:"0 5px",fontSize:10,fontWeight:700}}>late</span>}
      </div>
      {x.col>=4&&<div style={{marginTop:4}}><FlowDocDots td={t}/></div>}
    </div>;
  }

  function detail(t){
    var bids=biddersOf(t);var budget=Number(t.budget)||0;var cur=t.currency||"EUR";
    var priced=bids.filter(function(b){return Number(b.price)>0;}).sort(function(a,b){return Number(a.price)-Number(b.price);});
    var unpriced=bids.filter(function(b){return !(Number(b.price)>0);});
    var lo=priced.length?Number(priced[0].price):0;
    var mx=Math.max.apply(null,priced.map(function(b){return Number(b.price);}).concat([budget,1]));
    var aw=(t.awards||[]).filter(function(a){return a.subcontractor;});
    var cs=circuitState(circuitOf(t),now);
    var h3={fontSize:10.5,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#6f6b62",margin:"12px 0 6px"};
    return <div className="card" style={{marginTop:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8}}>
        <div><span style={{fontSize:11,color:"#9b968b"}}>{t.package||"—"}</span> <span style={{fontWeight:700,fontSize:15}}>{t.title}</span>
          <span style={{fontSize:11,color:"#6f6b62",marginLeft:8}}>Budget {budget?budget.toLocaleString()+" "+cur:"—"}</span></div>
        <div style={{display:"flex",gap:6}}>
          {onNavTender&&<button className="btn btn-sm btn-gold" onClick={function(){onNavTender(t.id,"procflow");}}>Open tender →</button>}
          <button className="btn btn-sm" onClick={function(){setSelId("");}}>✕</button>
        </div>
      </div>

      <div style={h3}>Tender results {aw.length>0&&<span style={{textTransform:"none",letterSpacing:0,fontWeight:600,color:"#1e6b3a",marginLeft:6}}>🏆 {aw.map(function(a){return a.subcontractor+" ("+awardStatus(a.status).label+")";}).join(", ")}</span>}</div>
      {bids.length===0
        ?<div style={{fontSize:12,color:"#9b968b"}}>No bidder recorded. Add them in the tender sheet → Flow &amp; history → Tender results.</div>
        :<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{color:"#9b968b",fontSize:10,textTransform:"uppercase",letterSpacing:".06em",textAlign:"left"}}>
            <th style={{padding:"3px 6px"}}>#</th><th>Bidder</th><th style={{textAlign:"right"}}>Price</th><th style={{textAlign:"right"}}>vs lowest</th><th style={{textAlign:"right"}}>Tech</th><th style={{width:"25%",paddingLeft:10}}>vs budget</th><th>Result</th></tr></thead>
          <tbody>{priced.concat(unpriced).map(function(b,i){
            var p=Number(b.price)||0;var won=b.result==="awarded";
            return <tr key={b.id} style={{borderTop:"1px solid #f0ede6"}}>
              <td style={{padding:"4px 6px",color:"#9b968b"}}>{p?i+1:""}</td>
              <td style={{fontWeight:won?700:400}}>{b.name||"—"}</td>
              <td style={{textAlign:"right",whiteSpace:"nowrap"}}>{p?p.toLocaleString():"—"}</td>
              <td style={{textAlign:"right",color:"#6f6b62"}}>{p?(p===lo?"lowest":"+"+Math.round((p/lo-1)*100)+" %"):""}</td>
              <td style={{textAlign:"right"}}>{b.techScore||"—"}</td>
              <td style={{paddingLeft:10}}><div style={{position:"relative",height:10,background:"#f5f3ee",borderRadius:2}}>
                {p>0&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:(p/mx*100)+"%",borderRadius:2,background:won?"#1e6b3a":budget&&p>budget?"#c62828":"#b9b4a8"}}/>}
                {budget>0&&<div title={"Budget "+budget.toLocaleString()} style={{position:"absolute",top:-2,bottom:-2,left:(budget/mx*100)+"%",borderLeft:"2px solid #16181d"}}/>}
              </div></td>
              <td style={{color:won?"#1e6b3a":"#9b968b",fontWeight:won?700:400}}>{b.result||"in review"}</td>
            </tr>;})}</tbody>
        </table>}

      <div style={h3}>Contract circuit {cs.totalDays!==null&&<span style={{textTransform:"none",letterSpacing:0,fontWeight:400,color:"#6f6b62",marginLeft:6}}>{cs.totalDays} d so far{cs.signedAll?" · signed "+fmtDate(cs.signedAll):""}</span>}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:"6px 12px",alignItems:"center"}}>
        {cs.stages.map(function(x,i){
          var c={done:["#1e6b3a","#fff","✓"],current:["#1a73e8","#fff",i+1],returned:["#c62828","#fff","↩"],blocked:["#e8e6df","#9b968b",i+1],todo:["#fff","#9b968b",i+1]}[x.state];
          var prev=i>0?cs.stages[i-1].stage.branch:"";
          return <React.Fragment key={x.stage.id}>
            {x.stage.branch==="sub"&&prev!=="sub"&&<span style={{flexBasis:"100%",fontSize:10,color:"#7b1fa2",fontWeight:700}}>in parallel, with the sub:</span>}
            {x.stage.branch==="join"&&<span style={{flexBasis:"100%",fontSize:10,color:"#6f6b62",fontWeight:700}}>then, once both are complete:</span>}
            <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5}} title={x.days?x.days+" d at this desk (target "+x.stage.days+" d)":""}>
              <span style={{width:18,height:18,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9.5,fontWeight:700,
                background:c[0],color:c[1],border:x.state==="todo"?"1px solid #c9c4b8":"none"}}>{c[2]}</span>
              <span style={{fontWeight:x.state==="current"?700:400,color:x.state==="current"?"#1a73e8":x.late?"#b3302a":"#16181d"}}>{x.stage.label.replace(/^Circulation to /,"")}</span>
              {x.days>0&&<span style={{fontSize:10,color:x.late?"#b3302a":"#9b968b"}}>{x.days}d</span>}
            </span>
          </React.Fragment>;
        })}
      </div>
      {!circuitOf(t).stored&&<div style={{fontSize:10.5,color:"#9b968b",marginTop:4}}>Not tracked desk by desk yet — dates from the Submission steps table.</div>}

      <div style={h3}>Documents</div>
      <FlowDocDots td={t}/>
    </div>;
  }

  return <div>
    <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:10,marginBottom:12}}>
      <div><div className="page-title">Procurement flow</div><div className="page-sub">Every live tender, by package and by stage. Click a card for its results and its contract circuit.</div></div>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Tender, package, subcontractor…" style={{width:240,padding:"5px 10px",fontSize:12}}/>
    </div>
    {list.length===0
      ?<div className="empty"><div className="empty-ico">🧭</div><div className="empty-txt">No live tender{q?" matches this search":""}.</div></div>
      :<div style={{overflowX:"auto"}}>
        <div style={{display:"grid",gridTemplateColumns:"84px repeat(6,minmax(150px,1fr))",minWidth:990,border:"1.5px solid #e8e6df",borderRadius:12,overflow:"hidden",background:"#fff"}}>
          <div style={{background:"#fafaf8",borderBottom:"1.5px solid #e8e6df"}}/>
          {PF_COLS.map(function(c,i){return <div key={c.k} title={c.tip} style={{background:"#fafaf8",borderBottom:"1.5px solid #e8e6df",borderLeft:"1px solid #f0ede6",padding:"6px 8px",
            fontSize:10.5,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#6f6b62",cursor:"help"}}>{c.label} <span style={{color:"#16181d"}}>{counts[i]}</span></div>;})}
          {pkgs.map(function(p){
            var rowT=list.filter(function(t){return (t.package||"—")===p;});
            return <React.Fragment key={p}>
              <div style={{padding:"8px",fontSize:11,fontWeight:700,background:"#fafaf8",borderBottom:"1px solid #f0ede6"}}>{p}<div style={{fontWeight:400,color:"#9b968b",fontSize:10}}>{rowT.length} tender{rowT.length>1?"s":""}</div></div>
              {PF_COLS.map(function(c){
                return <div key={c.k} style={{padding:6,borderLeft:"1px solid #f0ede6",borderBottom:"1px solid #f0ede6",minHeight:46}}>
                  {rowT.filter(function(t){return info[t.id].col===c.k;}).map(card)}
                </div>;
              })}
            </React.Fragment>;
          })}
        </div>
      </div>}
    <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:10.5,color:"#6f6b62",marginTop:8}}>
      {[["us","With us"],["client","With the client"],["sub","With the sub / bidders"],["internal","Internal contract circuit"]].map(function(x){
        return <span key={x[0]} style={{display:"flex",alignItems:"center",gap:4}}><span style={{background:whoBg[x[0]],color:whoCol[x[0]],borderRadius:8,padding:"0 6px",fontWeight:600}}>step · days</span>{x[1]}</span>;})}
      <span><span style={{background:"#fff3e0",color:"#b35c00",borderRadius:8,padding:"0 5px",fontWeight:700}}>R2</span> resubmissions</span>
      <span><span style={{background:"#fce4ec",color:"#b3302a",borderRadius:8,padding:"0 5px",fontWeight:700}}>late</span> delivery after the start on site</span>
    </div>
    {sel&&detail(sel)}
  </div>;
}

const AWARD_STATUSES=[
  {k:"proposed",label:"Proposed",bg:"#eee",fg:"#6f6b62"},
  {k:"awarded",label:"Awarded",bg:"var(--blue-soft,#e8f0fe)",fg:"var(--blue,#0f5299)"},
  {k:"signed",label:"Contract signed",bg:"var(--green-soft,#e6f2e9)",fg:"var(--green,#1e6b3a)"}
];
const AWARD_BOND_WARN_DAYS=30;
function awardStatus(k){return AWARD_STATUSES.find(function(s){return s.k===k;})||AWARD_STATUSES[0];}
function newAward(o){
  return Object.assign({id:uuid(),subcontractor:"",scope:"",status:"proposed",fin:newMomFin(),finSource:null,
    advBond:{required:"",amount:"",status:"",received:"",expiry:""},
    perfBondTrack:{status:"",received:"",expiry:""},
    contractStart:"",contractEnd:"",milestones:[],notes:""},o||{});
}
// Reads an award whatever its age: missing blocks are filled with defaults, never written back.
function normAward(a){
  var n=newAward(a);
  n.fin=newMomFin(n.fin);
  n.advBond=Object.assign({required:"",amount:"",status:"",received:"",expiry:""},n.advBond||{});
  n.perfBondTrack=Object.assign({status:"",received:"",expiry:""},n.perfBondTrack||{});
  n.milestones=n.milestones||[];
  return n;
}
function awardPerfBondAmount(a){
  var f=newMomFin(a.fin);
  var ls=momNum(f.lumpSum),p=momNum(f.perfBondPct);
  return (isNaN(ls)||isNaN(p))?NaN:ls*p/100;
}
// The advance bond defaults to the advance itself (the usual rule), unless typed otherwise.
function awardAdvBondAmount(a){
  var b=momNum((a.advBond||{}).amount);
  return !isNaN(b)?b:momNum((a.fin||{}).advance);
}
function awardDaysBetween(a,b){return Math.round((new Date(b)-new Date(a))/86400000);}
// Everything worth flagging on one award. `start` is the tender's schedule-driven start on site.
// Pure: tested in isolation.
function awardAlerts(a,start,now){
  var out=[];
  a=normAward(a);
  var f=a.fin;
  function add(lvl,txt){out.push({lvl:lvl,txt:txt});}
  if(a.contractStart&&a.contractEnd&&a.contractEnd<a.contractStart)
    add("red","Contractual completion is before the contractual start");
  if(start&&a.contractStart&&start<a.contractStart)
    add("amb","The schedule starts on "+fmtDate(start)+", "+awardDaysBetween(start,a.contractStart)+" d before the contractual start");
  (a.milestones||[]).forEach(function(m){
    if(!m.date)return;
    if((a.contractStart&&m.date<a.contractStart)||(a.contractEnd&&m.date>a.contractEnd))
      add("amb","Milestone “"+(m.label||"untitled")+"” falls outside the contract period");
  });
  var bonds=[];
  if(f.perfBond==="yes")bonds.push({name:"Performance bond",t:a.perfBondTrack});
  if(a.advBond.required==="yes"||(a.advBond.required===""&&!isNaN(momNum(f.advance))&&momNum(f.advance)>0))
    bonds.push({name:"Advance payment bond",t:a.advBond});
  bonds.forEach(function(b){
    if(b.t.status==="released")return;
    if(b.t.status!=="received"){
      // The performance bond is a condition precedent to any payment under the Subcontract.
      if(a.status==="signed")add(b.name==="Performance bond"?"red":"amb",b.name+" not received — contract is signed");
      return;
    }
    if(!b.t.expiry)return;
    var d=awardDaysBetween(now,b.t.expiry);
    if(d<0)add("red",b.name+" expired on "+fmtDate(b.t.expiry));
    else if(d<=AWARD_BOND_WARN_DAYS)add("amb",b.name+" expires in "+d+" d ("+fmtDate(b.t.expiry)+")");
  });
  return out;
}
// The review to copy from: same tender and same subcontractor first, then a review of the same
// tender with no subcontractor, then the same subcontractor on a review with no tender. Final beats Mid; then the most recent.
function findReviewForAward(moms,td,sub){
  var s=String(sub||"").trim().toLowerCase();
  var revs=(moms||[]).filter(function(m){return isTenderReview(m)&&(m.sections||[]).some(function(x){return x.kind==="finance";});});
  function sameSub(m){return !!s&&String(m.subcontractor||"").trim().toLowerCase()===s;}
  var tiers=[
    revs.filter(function(m){return m.tenderRef===td.id&&sameSub(m);}),
    // Same tender, but never another subcontractor's review: with several awards on one tender
    // that would copy a competitor's prices.
    revs.filter(function(m){return m.tenderRef===td.id&&(!s||!String(m.subcontractor||"").trim());}),
    revs.filter(function(m){return !m.tenderRef&&sameSub(m);})
  ];
  var pool=tiers.find(function(t){return t.length>0;})||[];
  return pool.slice().sort(function(a,b){
    var fa=a.reviewStage==="final"?1:0,fb=b.reviewStage==="final"?1:0;
    if(fa!==fb)return fb-fa;
    return (b.date||"").localeCompare(a.date||"");
  })[0]||null;
}

// The same company typed two ways ("Aktor" / "AKTOR SA") splits its colour, its filter and
// its tasks in the schedule, which reads the subcontractor straight from this section.
function normCompanyName(s){
  return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\u0370-\u03ff]+/g," ")
    .replace(/\b(s a|sa|a e|ae|ate|ltd|limited|llc|inc|ike|epe|oe|ee|sarl|sas|gmbh|spa|srl|bv|co|company|group)\b/g," ")
    .replace(/\s+/g," ").trim();
}
function similarCompany(name,list){
  var n=normCompanyName(name);
  if(!n)return "";
  return (list||[]).find(function(x){
    var m=normCompanyName(x);
    if(!m)return false;
    if(m===n)return true;
    return m.length>=4&&n.length>=4&&(m.indexOf(n)===0||n.indexOf(m)===0);
  })||"";
}
// Subcontractor picker of an award: a list (Settings › Subcontractors, the contractors and
// the names already used), plus "New…" which checks for a near-duplicate before creating.
function AwardSubSelect({value,options,onChange,style}){
  return <select value={value||""} style={style} onChange={function(e){
      var v=e.target.value;
      if(v!=="__new__"){onChange(v);return;}
      var typed=window.prompt("New subcontractor — the company name as it should appear everywhere:","");
      if(typed===null)return;
      typed=typed.trim();
      if(!typed)return;
      var exact=(options||[]).find(function(x){return x.toLowerCase()===typed.toLowerCase();});
      if(exact){onChange(exact);return;}
      var near=similarCompany(typed,options);
      if(near&&safeConfirm("“"+near+"” already exists.\n\nOK — use “"+near+"”\nCancel — create “"+typed+"” as a new company")){onChange(near);return;}
      onChange(typed);
    }}>
    <option value="">— choose —</option>
    {(options||[]).map(function(o){return <option key={o} value={o}>{o}</option>;})}
    <option value="__new__">＋ New subcontractor…</option>
  </select>;
}

function AwardsPanel({td,updTd,contractors}){
  const [openIds,setOpenIds]=useState({});
  var awards=(td.awards||[]).map(normAward);
  var start=td.startOnSite||"";
  var now=today();
  var subNames=[...new Set([].concat(
    (contractors||[]).map(function(c){return c.name;}),
    (window._ppSubList||[]),
    awards.map(function(a){return a.subcontractor;})
  ).filter(Boolean))].sort(function(a,b){return a.localeCompare(b);});

  // Every change is ONE updTd call carrying the whole list.
  function save(list){updTd("awards",list);}
  function upd(id,patch){save(awards.map(function(a){return a.id!==id?a:Object.assign({},a,patch);}));}
  function updSub(id,key,patch){
    var a=awards.find(function(x){return x.id===id;});
    upd(id,{[key]:Object.assign({},a[key],patch)});
  }
  function add(){
    var a=newAward();
    save(awards.concat([a]));
    setOpenIds(Object.assign({},openIds,{[a.id]:true}));
  }
  function remove(a){
    if(!safeConfirm("Remove the award to “"+(a.subcontractor||"unnamed subcontractor")+"”?\n\nIts financial conditions, bonds and milestones are deleted. Meeting minutes are not touched."))return;
    save(awards.filter(function(x){return x.id!==a.id;}));
  }
  function importReview(a){
    var moms=window._ppMoms;
    if(!moms){safeAlert("The meeting minutes are not loaded yet.\n\nOpen the Minutes of meeting view once, or reload the page, then try again.");return;}
    var m=findReviewForAward(moms,td,a.subcontractor);
    if(!m){safeAlert("No tender review with a price table was found for this tender"+(a.subcontractor?" or for "+a.subcontractor:"")+".");return;}
    var sec=(m.sections||[]).find(function(x){return x.kind==="finance";});
    var label=(m.number||"MoM")+" · "+momTitle(m)+" · "+(m.subcontractor||"no subcontractor")+" · "+fmtDate(m.date);
    var f=newMomFin(a.fin);
    var hasData=["lumpSum","advance","delayDamages","defectsMonths","perfBond","fixedPrice","mos"].some(function(k){return String(f[k]||"").trim();});
    if(!safeConfirm("Copy the price and financial conditions from:\n\n"+label+
      (hasData?"\n\nThe conditions already typed on this award will be replaced.":"")))return;
    var patch={fin:newMomFin(sec.fin),finSource:{momId:m.id,number:m.number||"",stage:m.reviewStage||"mid",date:m.date||""}};
    if(!a.subcontractor&&m.subcontractor)patch.subcontractor=m.subcontractor;
    upd(a.id,patch);
  }

  var total=awards.reduce(function(s,a){var n=momNum(a.fin.lumpSum);return s+(isNaN(n)?0:n);},0);
  var nAlerts=awards.reduce(function(s,a){return s+awardAlerts(a,start,now).length;},0);
  var inp={fontSize:12,padding:"4px 7px"};
  var lbl={fontSize:10.5,fontWeight:700,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".05em"};
  var mono={fontFamily:"var(--font-mono)",fontSize:12};

  return <div style={{marginBottom:10}}>
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Award &amp; contract conditions</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
        {awards.length===0?"no subcontractor yet":awards.length+" subcontractor"+(awards.length!==1?"s":"")+
          (total>0?" · total lump sum "+momEur(total):"")}
        {nAlerts>0&&<span style={{marginLeft:8,color:"var(--amber,#b35c00)",fontWeight:700}}>⚠ {nAlerts}</span>}</span>
      <button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={add}>＋ Subcontractor</button>
    </div>

    {awards.map(function(a){
      var isOpen=!!openIds[a.id];
      var st=awardStatus(a.status);
      var alerts=awardAlerts(a,start,now);
      var worst=alerts.some(function(x){return x.lvl==="red";})?"red":alerts.length?"amb":"";
      var pbAmt=awardPerfBondAmount(a),abAmt=awardAdvBondAmount(a);
      var advExpected=a.advBond.required==="yes"||(a.advBond.required===""&&!isNaN(momNum(a.fin.advance))&&momNum(a.fin.advance)>0);
      function bondRow(name,required,amount,track,key,requiredCtl){
        return <tr>
          <td><b>{name}</b></td>
          <td>{requiredCtl}</td>
          <td style={mono}>{required&&!isNaN(amount)?momEur(amount):"—"}</td>
          <td><select value={track.status||""} disabled={!required} onChange={function(e){updSub(a.id,key,{status:e.target.value,received:e.target.value==="received"&&!track.received?today():track.received});}} style={inp}>
            <option value="">—</option><option value="requested">Requested</option><option value="received">Received</option><option value="released">Released</option></select></td>
          <td><input type="date" value={track.received||""} disabled={!required} onChange={function(e){updSub(a.id,key,{received:e.target.value});}} style={inp}/></td>
          <td><input type="date" value={track.expiry||""} disabled={!required} onChange={function(e){updSub(a.id,key,{expiry:e.target.value});}} style={inp}/></td>
        </tr>;
      }
      return <div key={a.id} style={{border:"1.5px solid "+(worst==="red"?"var(--red,#b3302a)":worst==="amb"?"var(--amber,#b35c00)":"var(--rule,#ddd9cf)"),
          borderRadius:9,marginBottom:8,background:"#fff",overflow:"hidden"}}>
        <div style={{display:"flex",gap:8,alignItems:"center",padding:"7px 10px",flexWrap:"wrap",background:"#faf9f7",cursor:"pointer"}}
          onClick={function(){setOpenIds(Object.assign({},openIds,{[a.id]:!isOpen}));}}>
          <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ink-4,#9b968b)"}}>{isOpen?"▾":"▸"}</span>
          <b style={{fontSize:13}}>{a.subcontractor||<i style={{color:"var(--ink-4,#9b968b)",fontWeight:400}}>subcontractor to set</i>}</b>
          {a.scope&&<span style={{fontSize:12,color:"var(--ink-3,#6f6b62)"}}>· {a.scope}</span>}
          <span className="badge" style={{background:st.bg,color:st.fg,fontWeight:700}}>{st.label}</span>
          <span style={Object.assign({},mono,{marginLeft:"auto",fontWeight:700})}>{momEur(a.fin.lumpSum)||"—"}</span>
          {alerts.length>0&&<span className="badge" title={alerts.map(function(x){return x.txt;}).join("\n")}
            style={{background:worst==="red"?"#fbe6e8":"var(--amber-soft,#fdf1e0)",color:worst==="red"?"var(--red,#b3302a)":"var(--amber,#b35c00)",fontWeight:700}}>
            {worst==="red"?"🔴":"🟠"} {alerts.length}</span>}
        </div>

        {isOpen&&<div style={{padding:"10px 12px",display:"grid",gap:12}}>
          {alerts.length>0&&<div style={{display:"grid",gap:3}}>
            {alerts.map(function(x,i){return <div key={i} style={{fontSize:12,fontWeight:600,color:x.lvl==="red"?"var(--red,#b3302a)":"var(--amber,#b35c00)"}}>
              {x.lvl==="red"?"🔴":"🟠"} {x.txt}</div>;})}
          </div>}

          <div style={{display:"grid",gridTemplateColumns:"minmax(180px,1fr) minmax(200px,2fr) 170px",gap:10,alignItems:"end"}}>
            <label style={{display:"grid",gap:3}}><span style={lbl}>Subcontractor</span>
              <AwardSubSelect value={a.subcontractor} options={subNames} onChange={function(v){upd(a.id,{subcontractor:v});}} style={inp}/></label>
            <label style={{display:"grid",gap:3}}><span style={lbl}>Scope</span>
              <input type="text" value={a.scope} placeholder="e.g. North façade, levels 1–8" onChange={function(e){upd(a.id,{scope:e.target.value});}} style={inp}/></label>
            <label style={{display:"grid",gap:3}}><span style={lbl}>Status</span>
              <select value={a.status} onChange={function(e){upd(a.id,{status:e.target.value});}} style={inp}>
                {AWARD_STATUSES.map(function(s){return <option key={s.k} value={s.k}>{s.label}</option>;})}</select></label>
          </div>

          <div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
              <span style={lbl}>Price and financial conditions</span>
              {a.finSource&&<span className="badge" style={{background:"var(--gold-soft,#faf3e0)",color:"var(--gold-ink,#8a6a1e)"}}
                title="Copied from this meeting. Later edits here do not change the minutes.">
                from {a.finSource.number||"MoM"} · {a.finSource.stage==="final"?"Final":"Mid"} review · {fmtDate(a.finSource.date)}</span>}
              <button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){importReview(a);}}
                title="Copy the table of the Final tender review (or the Mid one if there is no Final)">⤓ Import from tender review</button>
            </div>
            <MomFinEditor fin={a.fin} onChange={function(p){upd(a.id,{fin:Object.assign({},a.fin,p)});}}/>
          </div>

          <div>
            <div style={Object.assign({},lbl,{marginBottom:5})}>Bonds</div>
            <table className="tbl" style={{fontSize:12}}>
              <thead><tr><th>Bond</th><th>Required</th><th>Amount</th><th>Status</th><th>Received</th><th>Expiry</th></tr></thead>
              <tbody>
                {bondRow("Performance bond "+(a.fin.perfBondPct||"7.5")+"%",a.fin.perfBond==="yes",pbAmt,a.perfBondTrack,"perfBondTrack",
                  <span style={{fontSize:12,color:"var(--ink-3,#6f6b62)"}} title="Set in the table above">{a.fin.perfBond==="yes"?"Yes":a.fin.perfBond==="no"?"No":"—"}</span>)}
                {bondRow("Advance payment bond",advExpected,abAmt,a.advBond,"advBond",
                  <div style={{display:"flex",gap:5,alignItems:"center"}}>
                    <select value={a.advBond.required} onChange={function(e){updSub(a.id,"advBond",{required:e.target.value});}} style={Object.assign({},inp,{width:80})}
                      title="Empty = required whenever an advance is paid">
                      <option value="">auto</option><option value="yes">Yes</option><option value="no">No</option></select>
                    {advExpected&&<input type="number" step="any" min="0" value={a.advBond.amount} placeholder={isNaN(momNum(a.fin.advance))?"€":String(momNum(a.fin.advance))}
                      title="Leave empty to use the advance amount" onChange={function(e){updSub(a.id,"advBond",{amount:e.target.value});}}
                      style={Object.assign({},inp,{width:110,fontFamily:"var(--font-mono)"})}/>}
                  </div>)}
              </tbody>
            </table>
          </div>

          <div>
            <div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap",marginBottom:6}}>
              <span style={lbl}>Contractual programme</span>
              <label style={{display:"grid",gap:3}}><span style={{fontSize:11}}>Start</span>
                <input type="date" value={a.contractStart} onChange={function(e){upd(a.id,{contractStart:e.target.value});}} style={inp}/></label>
              <label style={{display:"grid",gap:3}}><span style={{fontSize:11}}>Completion</span>
                <input type="date" value={a.contractEnd} onChange={function(e){upd(a.id,{contractEnd:e.target.value});}} style={inp}/></label>
              <span style={{fontSize:11.5,color:"var(--ink-3,#6f6b62)"}}
                title="Earliest schedule task linked to this tender, across every zone">
                Schedule start: <b style={mono}>{start?fmtDate(start):"no linked task"}</b></span>
              <button className="btn btn-sm" style={{marginLeft:"auto"}}
                onClick={function(){upd(a.id,{milestones:a.milestones.concat([{id:uuid(),label:"",date:"",dd:""}])});}}>＋ Key milestone</button>
            </div>
            {a.milestones.length>0&&<table className="tbl" style={{fontSize:12}}>
              <thead><tr><th style={{width:"46%"}}>Key milestone</th><th>Date</th><th>Delay damages (€/day)</th><th></th></tr></thead>
              <tbody>{a.milestones.map(function(m){
                function setM(p){upd(a.id,{milestones:a.milestones.map(function(x){return x.id!==m.id?x:Object.assign({},x,p);})});}
                return <tr key={m.id}>
                  <td><input type="text" value={m.label} onChange={function(e){setM({label:e.target.value});}} style={Object.assign({},inp,{width:"100%"})}/></td>
                  <td><input type="date" value={m.date} onChange={function(e){setM({date:e.target.value});}} style={inp}/></td>
                  <td><input type="number" step="any" min="0" value={m.dd} placeholder={a.fin.delayDamages||"€"} onChange={function(e){setM({dd:e.target.value});}}
                    style={Object.assign({},inp,{width:120,fontFamily:"var(--font-mono)"})}/></td>
                  <td><button className="btn btn-sm" title="Remove this milestone"
                    onClick={function(){upd(a.id,{milestones:a.milestones.filter(function(x){return x.id!==m.id;})});}}>🗑</button></td>
                </tr>;
              })}</tbody>
            </table>}
          </div>

          <label style={{display:"grid",gap:3}}><span style={lbl}>Other specific conditions</span>
            <textarea value={a.notes} onChange={function(e){upd(a.id,{notes:e.target.value});}}
              placeholder="Anything agreed that the table does not cover" style={Object.assign({},inp,{minHeight:44})}/></label>

          <div style={{display:"flex"}}>
            <button className="btn btn-sm" style={{marginLeft:"auto",color:"var(--red,#b3302a)"}} onClick={function(){remove(a);}}>🗑 Remove this award</button>
          </div>
        </div>}
      </div>;
    })}
    <datalist id={"aw-subs-"+td.id}>{subNames.map(function(n){return <option key={n} value={n}/>;})}</datalist>
  </div>;
}

// ============================================================================================
// Contract & addendums of ONE package (tender), seen from the package sheet.
// The contracts themselves stay where they always were — contractors[].contracts[], linked to
// the package by ct.tenderRef — so the Contracts view, the reports and the import keep working.
// This panel only reads / edits them in place: link or create a contract, follow its addendums
// (amount, ACC / Aconex approval), and see base + addendums against the budget.
// ============================================================================================
var AD_STATUS_OPTS=[["","— status —"],["not submitted","Not submitted"],["pending approval","Pending approval"],["rejected","Rejected"],["approved","✅ Approved"]];
// "Not sent to client": the amount is below the client's threshold, so this ACC / ACONEX
// never goes to the client (no status, no due date, not in the trackers). Field accNoClient / aconexNoClient.
function ctNoClient(o,dk){return !!(o&&o[dk+"NoClient"]);}
// One word per addendum: approved when the client approved it on either channel.
function addendumState(ad){
  var a=(ad&&ad.accStatus)||"",b=(ad&&ad.aconexStatus)||"";
  if(a==="approved"||b==="approved")return"approved";
  if(a==="rejected"||b==="rejected")return"rejected";
  if(a==="pending approval"||b==="pending approval")return"pending";
  return"draft";
}
var AD_STATE_COL={approved:["#e6f2e9","#1e6b3a","Approved"],pending:["#e8f0fe","#1a73e8","Pending"],rejected:["#fce4ec","#b3302a","Rejected"],draft:["#f2f0eb","#6f6b62","Draft"]};
function tenderContractTotals(td,contractors){
  var linked=(contractors||[]).flatMap(function(ctr){return (ctr.contracts||[]).filter(function(ct){return ct.tenderRef===td.id;}).map(function(ct){return{ct:ct,ctr:ctr};});});
  var t={linked:linked,base:0,adApproved:0,adPending:0,adOther:0,adCount:0,certified:0};
  linked.forEach(function(x){
    t.base+=Number(x.ct.amount||0);
    (x.ct.addendums||[]).forEach(function(ad){
      t.adCount++;var v=Number(ad.amount||0),st=addendumState(ad);
      if(st==="approved")t.adApproved+=v;else if(st==="pending")t.adPending+=v;else if(st!=="rejected")t.adOther+=v;
    });
    (x.ct.certifications||[]).forEach(function(c){t.certified+=Number(c.amount||0);});
  });
  t.current=t.base+t.adApproved;                       // signed today
  t.forecast=t.current+t.adPending+t.adOther;           // if every open addendum goes through
  return t;
}
function TenderContractsPanel({td,contractors,saveContractors,onOpenContracts}){
  const [linkSel,setLinkSel]=useState("");
  const [newFor,setNewFor]=useState("");
  const [openAd,setOpenAd]=useState({});
  var cur=td.currency||"EUR";
  var tot=tenderContractTotals(td,contractors);
  var budget=Number(td.budget)||0;
  var editable=!!saveContractors&&!isReadOnly();
  function fmt(n){return Math.round(Number(n)||0).toLocaleString();}

  function saveCt(ctrId,ctId,fn){
    if(blockIfReadOnly())return;
    saveContractors((contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){return ct.id!==ctId?ct:fn(ct);})});
    }));
  }
  function setCt(x,field,val){saveCt(x.ctr.id,x.ct.id,function(ct){var u=Object.assign({},ct);u[field]=val;return u;});}
  function setAd(x,adId,field,val){
    saveCt(x.ctr.id,x.ct.id,function(ct){
      return Object.assign({},ct,{addendums:(ct.addendums||[]).map(function(a){if(a.id!==adId)return a;var u=Object.assign({},a);u[field]=val;return u;})});
    });
  }
  function addAd(x){
    var ads=x.ct.addendums||[];
    var nums=ads.map(ctAddNo).filter(function(n){return n!=null;});
    var ad=Object.assign(newAddendum(),{number:String((nums.length?Math.max.apply(null,nums):0)+1),date:today()});
    saveCt(x.ctr.id,x.ct.id,function(ct){return Object.assign({},ct,{addendums:(ct.addendums||[]).concat([ad])});});
    setOpenAd(function(o){var n=Object.assign({},o);n[ad.id]=true;return n;});
  }
  function delAd(x,ad){
    if(!mayDelete()&&!isAppAdmin((window._currentUser||{}).name)){safeAlert("Deleting is not allowed for your account.");return;}
    if(!safeConfirm("Delete addendum "+(ad.number||"")+"?"))return;
    saveCt(x.ctr.id,x.ct.id,function(ct){return Object.assign({},ct,{addendums:(ct.addendums||[]).filter(function(a){return a.id!==ad.id;})});});
  }
  function unlink(x){
    if(!safeConfirm("Unlink contract "+(x.ct.number||"")+" from this package? The contract itself is kept (Contract › Contracts)."))return;
    setCt(x,"tenderRef","");
  }
  // Contracts that could be linked: not linked to this package yet. Awarded companies first.
  var awarded=(td.awards||[]).map(function(a){return normCompanyName(a.subcontractor);}).filter(Boolean);
  if(td.contractor)awarded.push(normCompanyName(td.contractor));
  function isAwarded(name){return awarded.indexOf(normCompanyName(name))>=0;}
  var linkable=(contractors||[]).flatMap(function(ctr){return (ctr.contracts||[]).filter(function(ct){return ct.tenderRef!==td.id;}).map(function(ct){return{ct:ct,ctr:ctr};});})
    .sort(function(a,b){return (isAwarded(b.ctr.name)?1:0)-(isAwarded(a.ctr.name)?1:0)||String(a.ctr.name).localeCompare(String(b.ctr.name));});
  function doLink(){
    var x=linkable.find(function(y){return y.ct.id===linkSel;});if(!x)return;
    if(x.ct.tenderRef&&!safeConfirm("This contract is linked to another package. Move it to this one?"))return;
    saveCt(x.ctr.id,x.ct.id,function(ct){return Object.assign({},ct,{tenderRef:td.id,package:ct.package||td.package||""});});
    setLinkSel("");
  }
  // New contract: for an existing subcontractor, or for an awarded company not created yet.
  var newOpts=[];
  (td.awards||[]).forEach(function(a){
    if(!a.subcontractor)return;
    var hit=(contractors||[]).find(function(c){return normCompanyName(c.name)===normCompanyName(a.subcontractor);});
    newOpts.push(hit?{v:"c:"+hit.id,l:"★ "+hit.name+" (awarded)"}:{v:"n:"+a.subcontractor,l:"★ "+a.subcontractor+" (awarded — creates the subcontractor)"});
  });
  (contractors||[]).slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name));}).forEach(function(c){
    if(!newOpts.some(function(o){return o.v==="c:"+c.id;}))newOpts.push({v:"c:"+c.id,l:c.name||"(no name)"});
  });
  function doNew(){
    if(!newFor||blockIfReadOnly())return;
    var nc=Object.assign(newContract(),{tenderRef:td.id,package:td.package||"",currency:cur,wbs:td.wbs||"",
      amount:Number(td.instructionAmount)||0,description:td.title||"",owner:td.ownerTender||""});
    var list=(contractors||[]).slice();
    if(newFor.indexOf("n:")===0){
      list=[newContractor({name:newFor.slice(2),package:td.package||"",tenderRefs:[td.id],contracts:[nc]})].concat(list);
    }else{
      var id=newFor.slice(2);
      list=list.map(function(c){return c.id!==id?c:Object.assign({},c,{contracts:(c.contracts||[]).concat([nc])});});
    }
    saveContractors(list);setNewFor("");
  }

  function tile(label,val,col,sub,tip){
    return <div title={tip||""} style={{flex:"1 1 130px",background:"#fafaf8",border:"1px solid #ece9e1",borderRadius:8,padding:"8px 12px",cursor:tip?"help":"default"}}>
      <div style={{fontSize:9.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"#6f6b62"}}>{label}</div>
      <div style={{fontSize:17,fontWeight:800,color:col||"#16181d"}}>{val}</div>
      {sub&&<div style={{fontSize:10.5,color:"#9b968b"}}>{sub}</div>}
    </div>;
  }
  var inp={padding:"3px 6px",fontSize:11.5};
  var vb=budget?budget-tot.forecast:null;

  return <div className="card" style={{marginBottom:10}}>
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"4px 0 10px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)",flexWrap:"wrap"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Contract &amp; addendums</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
        {tot.linked.length} contract{tot.linked.length!==1?"s":""} · {tot.adCount} addendum{tot.adCount!==1?"s":""}</span>
      {onOpenContracts&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={onOpenContracts} title="Certifications, scope, milestones, terms: the full contract sheet">📋 Open in Contracts ↗</button>}
    </div>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
      {tile("Budget",budget?fmt(budget)+" "+cur:"—")}
      {tile("Contract base",fmt(tot.base)+" "+cur,null,tot.linked.length?null:"no contract linked")}
      {tile("Addendums approved",fmt(tot.adApproved)+" "+cur,"#1e6b3a")}
      {tile("Addendums open",fmt(tot.adPending+tot.adOther)+" "+cur,tot.adPending+tot.adOther?"#1a73e8":null,"pending "+fmt(tot.adPending)+" · draft "+fmt(tot.adOther),"Pending = submitted to ACC or Aconex. Draft = not submitted yet. Rejected addendums are not counted.")}
      {tile("Current value",fmt(tot.current)+" "+cur,"#b45309","base + approved")}
      {tile("Forecast",fmt(tot.forecast)+" "+cur,null,vb===null?"":(vb<0?"⚠ ":"")+(vb>=0?"+":"")+fmt(vb)+" vs budget","Base + every addendum not rejected")}
      {tot.certified>0&&tile("Certified",fmt(tot.certified)+" "+cur,"#7b1fa2",tot.current?Math.round(tot.certified/tot.current*100)+" % of current":"")}
    </div>

    {tot.linked.length===0&&<div style={{fontSize:12,color:"#9b968b",marginBottom:10}}>No contract is linked to this package yet. Link an existing one or create it below.</div>}

    {tot.linked.map(function(x){
      var ct=x.ct,ads=(ct.addendums||[]).slice().sort(function(a,b){var na=ctAddNo(a),nb=ctAddNo(b);if(na!=null&&nb!=null&&na!==nb)return na-nb;return (a.date||"").localeCompare(b.date||"");});
      var eff=contractEffective(ct);
      var cum=Number(ct.amount||0);
      return <div key={ct.id} style={{border:"1px solid #e8e6df",borderRadius:9,marginBottom:12,overflow:"hidden"}}>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",padding:"9px 12px",background:"#faf8f3",borderBottom:"1px solid #ece9e1"}}>
          <b style={{fontSize:13}}>{x.ctr.name||"Subcontractor"}</b>
          <span style={{display:"flex",gap:4,alignItems:"center",fontSize:11}}>No.
            <input type="text" value={ct.number||""} disabled={!editable} onChange={function(e){setCt(x,"number",e.target.value);}} placeholder="contract no." style={Object.assign({},inp,{width:110,fontFamily:"var(--font-mono)"})}/></span>
          <span style={{display:"flex",gap:4,alignItems:"center",fontSize:11}}>Base
            <input type="number" value={ct.amount||""} disabled={!editable} onChange={function(e){setCt(x,"amount",e.target.value);}} style={Object.assign({},inp,{width:110,textAlign:"right"})}/>{ct.currency||cur}</span>
          <span style={{display:"flex",gap:4,alignItems:"center",fontSize:11}}>Start
            <input type="date" value={ct.startDate||""} disabled={!editable} onChange={function(e){setCt(x,"startDate",e.target.value);}} style={inp}/></span>
          <span style={{display:"flex",gap:4,alignItems:"center",fontSize:11}}>End
            <input type="date" value={ct.endDate||""} disabled={!editable} onChange={function(e){setCt(x,"endDate",e.target.value);}} style={inp}/>
            {eff.extensionDays?<span className="badge" title={"Changed by "+eff.changedBy.endDate} style={{background:"#f3e5f5",color:"#7b1fa2"}}>→ {fmtDate(eff.endDate)} (+{eff.extensionDays} d)</span>:null}</span>
          <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:11,margin:0}}>
            <input type="checkbox" checked={!!ct.closed} disabled={!editable} onChange={function(e){setCt(x,"closed",e.target.checked);}} style={{width:13,height:13}}/>Closed</label>
          {editable&&<button className="btn btn-sm" style={{marginLeft:"auto",fontSize:10.5}} onClick={function(){unlink(x);}}>Unlink</button>}
        </div>
        <table className="tbl" style={{fontSize:11.5,margin:0}}>
          <thead><tr>
            <th style={{width:70}}>Add.</th><th style={{width:120}}>Date</th><th>Description</th>
            <th style={{width:120,textAlign:"right"}}>Amount ({ct.currency||cur})</th><th style={{width:110,textAlign:"right"}}>Cumulative</th>
            <th style={{width:90}}>State</th><th style={{width:60}}></th>
          </tr></thead>
          <tbody>
            <tr style={{background:"#fbfaf7"}}><td colSpan={3} style={{fontWeight:600,color:"#6f6b62"}}>Original contract{ct.startDate?" · "+fmtDate(ct.startDate):""}</td>
              <td style={{textAlign:"right",fontWeight:700}}>{fmt(ct.amount)}</td><td style={{textAlign:"right"}}>{fmt(cum)}</td><td colSpan={2}></td></tr>
            {ads.map(function(ad){
              var st=addendumState(ad),k=AD_STATE_COL[st];
              if(st!=="rejected")cum+=Number(ad.amount||0);
              var open=!!openAd[ad.id];
              return <React.Fragment key={ad.id}>
                <tr style={{opacity:st==="rejected"?.55:1}}>
                  <td><input type="text" value={ad.number||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,"number",e.target.value);}} style={Object.assign({},inp,{width:56,fontWeight:700})}/></td>
                  <td><input type="date" value={ad.date||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,"date",e.target.value);}} style={inp}/></td>
                  <td><input type="text" value={ad.description||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,"description",e.target.value);}} placeholder="What changes…" style={Object.assign({},inp,{width:"100%"})}/></td>
                  <td style={{textAlign:"right"}}><input type="number" value={ad.amount||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,"amount",e.target.value);}} style={Object.assign({},inp,{width:105,textAlign:"right"})}/></td>
                  <td style={{textAlign:"right",color:"#6f6b62"}}>{fmt(cum)}</td>
                  <td><span className="badge" style={{background:k[0],color:k[1]}}>{k[2]}</span></td>
                  <td style={{whiteSpace:"nowrap"}}>
                    <button className="btn btn-sm" style={{padding:"0 6px",fontSize:10}} onClick={function(){setOpenAd(function(o){var n=Object.assign({},o);n[ad.id]=!o[ad.id];return n;});}} title="Approval (ACC / Aconex), instruction, comment">{open?"▾":"▸"}</button>
                    {editable&&<button onClick={function(){delAd(x,ad);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:12}}>🗑</button>}
                  </td>
                </tr>
                {open&&<tr><td colSpan={7} style={{background:"#faf9f6",padding:"8px 12px"}}>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",fontSize:11}}>
                    {["acc","aconex"].map(function(dk){
                      var nc=ctNoClient(ad,dk);
                      return <span key={dk} style={{display:"flex",gap:4,alignItems:"center"}}><b style={{color:dk==="acc"?"#1a73e8":"#7b1fa2"}}>{dk==="acc"?"ACC":"ACONEX"}</b>
                        {!nc&&<select value={ad[dk+"Status"]||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,dk+"Status",e.target.value);}} style={inp}>
                          {AD_STATUS_OPTS.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select>}
                        {!nc&&<input type="date" value={ad[dk+"Date"]||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,dk+"Date",e.target.value);}} style={inp}/>}
                        <label title="Amount too low: this document does not go to the client" style={{display:"flex",alignItems:"center",gap:3,textTransform:"none",letterSpacing:"normal",fontSize:10.5,fontWeight:500,color:nc?"#1e6b3a":"#6f6b62",cursor:editable?"pointer":"default"}}>
                          <input type="checkbox" checked={nc} disabled={!editable} onChange={function(e){setAd(x,ad.id,dk+"NoClient",e.target.checked);}} style={{width:12,height:12}}/>Not sent to client (amount too low)</label></span>;
                    })}
                    <span style={{display:"flex",gap:4,alignItems:"center"}}>INS #
                      <input type="text" value={ad.instructionNumber||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,"instructionNumber",e.target.value);}} style={Object.assign({},inp,{width:90})}/></span>
                    <input type="text" value={ad.comment||""} disabled={!editable} onChange={function(e){setAd(x,ad.id,"comment",e.target.value);}} placeholder="Comment…" style={Object.assign({},inp,{flex:"1 1 200px"})}/>
                  </div>
                </td></tr>}
              </React.Fragment>;
            })}
            <tr style={{background:"#fffaf0"}}><td colSpan={3} style={{fontWeight:700}}>Total{ads.length?" · "+ads.length+" addendum"+(ads.length!==1?"s":""):""}</td>
              <td style={{textAlign:"right",fontWeight:800,color:"#b45309"}}>{fmt(cum)}</td><td colSpan={3} style={{fontSize:10.5,color:"#9b968b"}}>rejected addendums not counted</td></tr>
          </tbody>
        </table>
        {editable&&<div style={{padding:"7px 12px"}}><button className="btn btn-sm" onClick={function(){addAd(x);}}>＋ Addendum</button></div>}
      </div>;
    })}

    {editable&&<div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center",paddingTop:4}}>
      <span style={{display:"flex",gap:6,alignItems:"center",fontSize:12}}>
        <select value={linkSel} onChange={function(e){setLinkSel(e.target.value);}} style={Object.assign({},inp,{maxWidth:320})}>
          <option value="">Link an existing contract…</option>
          {linkable.map(function(y){return <option key={y.ct.id} value={y.ct.id}>{(isAwarded(y.ctr.name)?"★ ":"")+(y.ctr.name||"?")+" — "+(y.ct.number||"no number")+(y.ct.tenderRef?" (linked elsewhere)":"")}</option>;})}
        </select>
        <button className="btn btn-sm" disabled={!linkSel} onClick={doLink}>Link</button>
      </span>
      <span style={{display:"flex",gap:6,alignItems:"center",fontSize:12}}>
        <select value={newFor} onChange={function(e){setNewFor(e.target.value);}} style={Object.assign({},inp,{maxWidth:320})}>
          <option value="">New contract for…</option>
          {newOpts.map(function(o){return <option key={o.v} value={o.v}>{o.l}</option>;})}
        </select>
        <button className="btn btn-sm" disabled={!newFor} onClick={doNew}>＋ Create</button>
      </span>
    </div>}
  </div>;
}

function TendersView({tenders,saveTenders,packages,people,tasks,saveTasks,contractors,saveContractors,pkgOwners,jumpTender,clearJumpTender,jumpFrom,onBack,onNavZone,onNavContracts}){

  function lsGet(key,fallback){try{var v=localStorage.getItem(key);return v!==null?v:fallback;}catch(e){return fallback;}}
  function lsSet(key,val){try{localStorage.setItem(key,val);}catch(e){}}

  const [pkgFilter,setPkgFilter]=useState(function(){return lsGet("pp_tv_pkgFilter","all");});
  const [searchQ,setSearchQ]=useState(function(){return lsGet("pp_tv_searchQ","");});
  const [sortCol,setSortCol]=useState(function(){return lsGet("pp_tv_sortCol","title");});
  const [sortDir,setSortDir]=useState(function(){return lsGet("pp_tv_sortDir","asc");});
  const [selTender,setSelTenderRaw]=useState(function(){
    var savedId=lsGet("pp_tv_selTenderId","");
    if(savedId){var found=(tenders||[]).find(function(t){return t.id===savedId;});if(found)return found;}
    return null;
  });
  const [showForm,setShowForm]=useState(false);
  const [formData,setFormData]=useState(null);
  const [processPct,setProcessPct]=useState({});
  const [processBids,setProcessBids]=useState({});
  const [procOpen,setProcOpen]=useState(false);
  const [roomPickTask,setRoomPickTask]=useState(null);
  const [showProcDetail,setShowProcDetail]=useState(false);

  // setSelTender wrapper: pushes a browser history entry ONLY when actually navigating to a different tender
  // (not on every field edit refresh, which also calls setSelTender with the same tender's updated data)
  const [qLinked,setQLinked]=useState("");
  const [hideDoneLinked,setHideDoneLinked]=useState(true);
  // List filters by phase (reset at each visit) and one quick filter at a time
  const [phaseSel,setPhaseSel]=useState({pre:true,ctr:true,sig:true,can:false});
  const [quickF,setQuickF]=useState("");
  const [showTl,setShowTl]=useState(true);
  const [showGaps,setShowGaps]=useState(false);
  const [showPrint,setShowPrint]=useState(false);
  const [linkedOpen,setLinkedOpen]=useState(true);
  // Package sheet tabs: each document is edited in ONE place (Submissions); the rest is read
  // or linked from the other tabs. Remembered per browser.
  const [tdTab,setTdTabRaw]=useState(function(){return lsGet("pp_tv_tdTab","docs");});
  function setTdTab(t){setTdTabRaw(t);try{lsSet("pp_tv_tdTab",t);}catch(e){}}
  const [docFocus,setDocFocus]=useState(null);
  function jumpToDoc(id){setTdTab("docs");setDocFocus({id:id,n:Date.now()});}
  var selTenderIdRef=useRef(selTender?selTender.id:"");
  function setSelTender(t){
    var newId=t?t.id:"";
    if(newId!==selTenderIdRef.current){
      selTenderIdRef.current=newId;
      try{history.pushState({pp_tendersNav:true,selTenderId:newId},"",location.href);}catch(e){}
    }
    setSelTenderRaw(t);
  }

  useEffect(function(){lsSet("pp_tv_pkgFilter",pkgFilter);},[pkgFilter]);
  useEffect(function(){lsSet("pp_tv_searchQ",searchQ);},[searchQ]);
  useEffect(function(){lsSet("pp_tv_sortCol",sortCol);},[sortCol]);
  useEffect(function(){lsSet("pp_tv_sortDir",sortDir);},[sortDir]);
  useEffect(function(){lsSet("pp_tv_selTenderId",selTender?selTender.id:"");},[selTender]);

  useEffect(function(){
    function onPop(e){
      if(e.state&&e.state.pp_tendersNav!==undefined){
        var id=e.state.selTenderId;
        selTenderIdRef.current=id||"";
        if(id){var found=(tenders||[]).find(function(t){return t.id===id;});setSelTenderRaw(found||null);}
        else{setSelTenderRaw(null);}
      }
    }
    window.addEventListener("popstate",onPop);
    return function(){window.removeEventListener("popstate",onPop);};
  },[tenders]);

  useEffect(function(){
    if(jumpTender){
      var t=(tenders||[]).find(function(x){return x.id===jumpTender;});
      if(t){setSelTender(t);}
      // Coming from a document view (Materials, WMS/ITP, client follow-up): open on the documents.
      if(["materials","qadocs","submissions"].indexOf(jumpFrom)>=0)setTdTab("docs");
      if(clearJumpTender)clearJumpTender();
    }
  },[jumpTender]);

  const allPkgs=[...new Set((tenders||[]).map(function(t){return t.package;}).filter(Boolean))].sort();

  function toggleSort(col){if(sortCol===col)setSortDir(function(d){return d==="asc"?"desc":"asc";});else{setSortCol(col);setSortDir("asc");}}
  function sortIcon(col){if(sortCol!==col)return " ↕";return sortDir==="asc"?" ↑":" ↓";}

  var filtered=React.useMemo(function(){
    var list=(tenders||[]).filter(function(t){
      if(pkgFilter!=="all"&&t.package!==pkgFilter)return false;
      if(searchQ){var q=searchQ.toLowerCase();if(!(t.title||"").toLowerCase().includes(q)&&!(t.ownerTender||"").toLowerCase().includes(q)&&!(t.package||"").toLowerCase().includes(q))return false;}
      if(!phaseSel[tenderPhase(t)])return false;
      if(quickF&&!tenderQuick(t,quickF))return false;
      return true;
    });
    return list.slice().sort(function(a,b){
      var r=0;
      if(sortCol==="package"){r=(a.package||"").localeCompare(b.package||"")||((a.title||"").localeCompare(b.title||""));}
      else if(sortCol==="owner"){r=(a.ownerTender||"").localeCompare(b.ownerTender||"");}
      else if(sortCol==="status"){
        // Phase first (before approval → contract phase → signed → cancelled), then how far
        // the contract went, then the name — the name always reads A→Z inside a phase.
        r=(TENDER_PHASE_ORDER[tenderPhase(a)]-TENDER_PHASE_ORDER[tenderPhase(b)])||(tenderContractStage(a)-tenderContractStage(b));
        if(sortDir!=="asc")r=-r;
        return r||(a.title||"").localeCompare(b.title||"");
      }
      else if(sortCol==="contract"){r=tenderContractStage(a)-tenderContractStage(b);}
      else if(TENDER_STEPS.some(function(st){return st.key===sortCol;})){
        // A step column sorts by how far the step went, not alphabetically.
        r=tenderStepRank(sortCol,(a.steps||{})[sortCol])-tenderStepRank(sortCol,(b.steps||{})[sortCol]);
        if(sortDir!=="asc")r=-r;
        return r||(a.title||"").localeCompare(b.title||"");
      }
      else{r=(a.title||"").localeCompare(b.title||"");}
      return sortDir==="asc"?r:-r;
    });
  },[tenders,pkgFilter,searchQ,sortCol,sortDir,phaseSel,quickF]);
  // Counts on the phase chips: what the package filter and the search leave, before phases
  var phaseCounts=(function(){
    var c={pre:0,ctr:0,sig:0,can:0};
    (tenders||[]).forEach(function(t){
      if(pkgFilter!=="all"&&t.package!==pkgFilter)return;
      if(searchQ){var q=searchQ.toLowerCase();if(!(t.title||"").toLowerCase().includes(q)&&!(t.ownerTender||"").toLowerCase().includes(q)&&!(t.package||"").toLowerCase().includes(q))return;}
      c[tenderPhase(t)]++;
    });
    return c;
  })();
  var listRange=showTl&&!selTender?tenderListRange(filtered):null;

  function openNew(){var nt=newTender();var d=[nt,...(tenders||[])];saveTenders(d);setSelTender(nt);}
  function openEdit(td){setFormData(JSON.parse(JSON.stringify(td)));setShowForm(true);}
  function saveTender(td){
    var d=(tenders||[]).find(function(x){return x.id===td.id;})?(tenders||[]).map(function(x){return x.id===td.id?td:x;}):[td,...(tenders||[])];
    saveTenders(d);setShowForm(false);if(selTender&&selTender.id===td.id)setSelTender(td);
  }
  function delTender(id){saveTenders((tenders||[]).filter(function(t){return t.id!==id;}));setSelTender(null);}

  function autoActionForTender(td2,text,tag,overrides){
    if(!saveTasks||!tasks)return;
    var exists=(tasks||[]).some(function(t){return t.tenderRef===td2.id&&t.text===text&&t.status!=="done";});
    if(exists)return;
    var owner=(pkgOwners||{})[td2.package||""]||td2.ownerTender||"";
    var base={text:text,owner:owner,tenderRef:td2.id,package:td2.package||"",tags:[tag||"Contract"],status:"pending",note:"Auto-created from contract/ACC status",addedBy:"System"};
    saveTasks([newTask(Object.assign(base,overrides||{})),...(tasks||[])]);
  }
  function closeActionForTender(td2,text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td2.id&&t.text===text&&t.status!=="done";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===td2.id&&t.text===text&&t.status!=="done")?Object.assign({},t,{status:"done",completedAt:today()}):t;}));
  }
  // Removes a still-pending auto-created action (used when a date that justified it gets cleared)
  function removeSystemAction(tid,text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===tid&&t.text===text&&t.status!=="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).filter(function(t){return!(t.tenderRef===tid&&t.text===text&&t.status!=="done"&&t.addedBy==="System");}));
  }
  // Reopens an auto-closed action (used when a done-date that closed it gets cleared)
  function reopenSystemAction(tid,text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===tid&&t.text===text&&t.status==="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===tid&&t.text===text&&t.status==="done"&&t.addedBy==="System")?Object.assign({},t,{status:"pending",completedAt:""}):t;}));
  }
  var SUBMIT_RESULT_STEPS={
    acc:{text:function(t){return"Submit the Tender Result — "+t.title;},tag:function(){return"Procurement";}},
    itp:{text:function(t){return"Submit the ITP — "+t.title;},tag:function(t){return qualityTag(t.package||"");}},
    wms:{text:function(t){return"Submit the WMS — "+t.title;},tag:function(){return null;}},
    kickoff:{text:function(t){return"Hold the kick off meeting — "+t.title;},tag:function(){return null;}}
  };
  function syncSubmitResultAction(updatedTd,step,targetVal,doneNow){
    var cfg=SUBMIT_RESULT_STEPS[step];
    if(!cfg||!targetVal||doneNow)return;
    var text=cfg.text(updatedTd);
    var tag=cfg.tag(updatedTd);
    var overrides={due:targetVal,importance:3,urgence:calcProcurementUrgence(targetVal)};
    if(tag)overrides.tags=[tag];else overrides.tags=[];
    var exists=(tasks||[]).some(function(t){return t.tenderRef===updatedTd.id&&t.text===text&&t.status!=="done";});
    if(exists){
      saveTasks((tasks||[]).map(function(t){return(t.tenderRef===updatedTd.id&&t.text===text&&t.status!=="done")?Object.assign({},t,overrides):t;}));
    }else{
      autoActionForTender(updatedTd,text,tag||"Contract",overrides);
    }
  }
  // Flow & history edits: the automatic actions that the old date fields used to trigger,
  // computed in one pass and saved once.
  function flowAfterSave(prevTd,nextTd){
    if(!saveTasks||!tasks)return;
    var owner=(pkgOwners||{})[nextTd.package||""]||nextTd.ownerTender||"";
    var next=flowTaskChanges(prevTd,nextTd,tasks,owner);
    if(next)saveTasks(next);
  }
  function updateStep(tdId,step,field,val){
    var prevTd=(tenders||[]).find(function(t){return t.id===tdId;});
    var prevAccDone=prevTd?(((prevTd.stepDates||{}).acc||{}).done||""):"";
    var prevStepDone=prevTd?(((prevTd.stepDates||{})[step]||{}).done||""):"";
    var prevStepTarget=prevTd?(((prevTd.stepDates||{})[step]||{}).target||""):"";
    var d=(tenders||[]).map(function(t){
      if(t.id!==tdId)return t;
      var sd=Object.assign({},t.stepDates||{});
      if(!sd[step])sd[step]={target:"",done:""};
      var steps=Object.assign({},t.steps||{});
      var sc=Object.assign({},t.stepComments||{});
      var sl=Object.assign({},t.stepLinks||{});
      if(!sl[step])sl[step]=[];
      if(field==="status")steps[step]=val;
      else if(field==="comment"){sc[step]=val;}
      else if(field==="links"){sl[step]=val;}
      else if(field==="approval"||field==="target"||field==="done"||field==="bids"){var cur=Object.assign({},sd[step]||{});cur[field]=val;sd[step]=cur;}
      else{var cur2=Object.assign({},sd[step]);cur2[field]=val;sd[step]=cur2;}
      return Object.assign({},t,{steps:steps,stepDates:sd,stepComments:sc,stepLinks:sl});
    });
    saveTenders(d);
    var updatedTd=d.find(function(t){return t.id===tdId;});
    if(selTender&&selTender.id===tdId)setSelTender(updatedTd);
    var apprText="Get the approval of the Tender result from the client — "+updatedTd.title;

    // Trigger "Contract Request to be sent" ONLY when ACC/Aconex gets a Date done (not on target/status changes)
    if(updatedTd&&step==="acc"&&field==="done"&&val&&!prevAccDone){
      var reqDone=((updatedTd.stepDates||{}).contract||{}).requestDone||"";
      if(!reqDone)autoActionForTender(updatedTd,"Contract Request to be sent — "+updatedTd.title);
    }
    // Trigger "Get the approval of the Tender result from the client" once ACC/Aconex is submitted (Date done filled)
    if(updatedTd&&step==="acc"&&field==="done"&&val&&!prevAccDone){
      var apprDueVal=addWorkingDays(val,getDur("accApproval"));
      autoActionForTender(updatedTd,apprText,"Procurement",{due:apprDueVal,importance:3,urgence:calcProcurementUrgence(apprDueVal)});
    }
    // ACC Date done CLEARED (was filled, now empty): undo — remove the two tasks it created, reopen "Submit the Tender Result" if target still set
    if(updatedTd&&step==="acc"&&field==="done"&&!val&&prevAccDone){
      removeSystemAction(updatedTd.id,"Contract Request to be sent — "+updatedTd.title);
      removeSystemAction(updatedTd.id,apprText);
      var accTargetStill=((updatedTd.stepDates||{}).acc||{}).target||"";
      if(accTargetStill)reopenSystemAction(updatedTd.id,SUBMIT_RESULT_STEPS.acc.text(updatedTd));
    }
    // Close "Get the approval..." once ACC/Aconex Date of approval OR approval status is filled (client responded)
    if(updatedTd&&step==="acc"&&field==="approval"&&val){
      closeActionForTender(updatedTd,apprText);
    }
    if(updatedTd&&step==="acc"&&field==="approval"&&!val){
      reopenSystemAction(updatedTd.id,apprText);
    }
    if(updatedTd&&step==="acc"&&field==="approvalDateObj"&&val&&val.approvalStatus&&val.approvalStatus!=="—"){
      closeActionForTender(updatedTd,apprText);
    }
    // Trigger "Submit the [Tender/ITP/WMS] Result" when the step gets a Target date but no Date done yet (ACC, ITP, WMS)
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&field==="target"&&val){
      var stepDoneNow=((updatedTd.stepDates||{})[step]||{}).done||"";
      syncSubmitResultAction(updatedTd,step,val,stepDoneNow);
    }
    // Target date CLEARED (was set, now empty): remove "Submit the ... Result" if still pending
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&field==="target"&&!val&&prevStepTarget){
      removeSystemAction(updatedTd.id,SUBMIT_RESULT_STEPS[step].text(updatedTd));
    }
    // Close "Submit the [Tender/ITP/WMS] Result" once the step's Date done is filled
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&field==="done"&&val&&!prevStepDone){
      closeActionForTender(updatedTd,SUBMIT_RESULT_STEPS[step].text(updatedTd));
    }
    // Date done CLEARED (was filled, now empty): reopen "Submit the ... Result" if target still set (ITP/WMS; ACC handled above with its own extra tasks)
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&step!=="acc"&&field==="done"&&!val&&prevStepDone){
      var stillTarget=((updatedTd.stepDates||{})[step]||{}).target||"";
      if(stillTarget)reopenSystemAction(updatedTd.id,SUBMIT_RESULT_STEPS[step].text(updatedTd));
    }
  }

  var linkedTasks=selTender?(tasks||[]).filter(function(t){return t.tenderRef===selTender.id;}):[];

  if(selTender){
    var td=selTender;
    var linkedTasks=(tasks||[]).filter(function(t){return t.tenderRef===td.id;});
    var qL=qLinked.trim().toLowerCase();
    var shownLinked=linkedTasks.filter(function(t){
      if(hideDoneLinked&&t.status==="done")return false;
      if(!qL)return true;
      var hay=[t.text,t.owner,t.status,t.note,(t.tags||[]).join(" "),t.package,t.zone].join(" ").toLowerCase();
      return qL.split(/\s+/).every(function(w){return hay.indexOf(w)>=0;});
    });
    // Accepts a field name or a whole object. Three sequential single-field calls each
    // rebuilt from the same stale `tenders`, so only the last one survived — which is why
    // picking an SD status appeared to do nothing.
    function updTd(field,val){
      var patch=(field&&typeof field==="object")?field:{[field]:val};
      var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,patch);});
      saveTenders(d);
      setSelTender(d.find(function(t){return t.id===td.id;}));
    }
    var cur=td.currency||"EUR";
    var budget=Number(td.budget)||0;
    var accSub=Number(td.accAmountSubcontract)||0;
    var accOther=Number(td.accAmountOther)||0;
    var accTotal=accSub+accOther;
    var treated=Number(td.accAmountTreated)||0;
    var matProposedTotal=(td.materials||[]).reduce(function(s,m){return s+Number(m.proposed||0);},0);
    var proposed=matProposedTotal>0?matProposedTotal:accTotal;
    var instructed=Number(td.instructionAmount)||0;
    var isReleased=td.released||false;
    var effectiveCost=proposed;
    var variance=budget>0&&effectiveCost>0?budget-effectiveCost:0;
    var varianceLabel="Budget − Proposed";
    var linkedContracts=(contractors||[]).flatMap(function(ctr){return (ctr.contracts||[]).filter(function(ct){return ct.tenderRef===td.id;}).map(function(ct){return{ct,ctr};});});
    var contractTotal=linkedContracts.reduce(function(s,x){return s+Number(x.ct.amount||0);},0);
    var addendumTotal=linkedContracts.reduce(function(s,x){return s+(x.ct.addendums||[]).reduce(function(s2,ad){return s2+Number(ad.amount||0);},0);},0);
    var contractGrand=contractTotal+addendumTotal;
    // Use contract total as instructed if available
    var instructedAmount=contractGrand>0?contractGrand:Number(td.instructionAmount)||0;

    return <div className="md-wrap" style={{display:"flex",gap:16,alignItems:"flex-start"}}>

      <div className="md-side" style={{width:200,flexShrink:0,background:"#fff",borderRadius:12,border:"1.5px solid #e8e6df",overflow:"hidden",position:"sticky",top:0,alignSelf:"flex-start"}}>
        <div style={{padding:"8px 10px",borderBottom:"1.5px solid #e8e6df",fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>Packages</div>
        <div style={{padding:"6px 8px",borderBottom:"1px solid #f0ede6"}}>
          <select value={pkgFilter} onChange={function(e){setPkgFilter(e.target.value);}} style={{fontSize:11,border:"none",background:"transparent",fontFamily:"inherit",width:"100%"}}>
            <option value="all">All departments</option>
            {allPkgs.map(function(p){return <option key={p} value={p}>{p}</option>;})}
          </select>
        </div>
        <div style={{maxHeight:600,overflowY:"auto"}}>
          {filtered.map(function(t){var isActive=t.id===selTender.id;return <div key={t.id} onClick={function(){setSelTender(t);}} style={{padding:"7px 10px",cursor:"pointer",background:isActive?"#f0ede6":"transparent",borderLeft:"3px solid "+(isActive?"#c9a84c":"transparent"),fontSize:11,fontWeight:isActive?700:400}}>{t.title}</div>;})}
        </div>
      </div>

      <div style={{flex:1,minWidth:0}}>

        <div style={{position:"sticky",top:0,zIndex:30,background:"#f4f3f0",display:"flex",gap:6,paddingBottom:6,paddingTop:2,marginBottom:6}}>
          {onBack&&<button className="btn btn-sm" onClick={onBack} style={{flexShrink:0,color:"var(--blue)",borderColor:"var(--blue)"}}>← Back to {jumpFrom}</button>}
          <button className="btn btn-sm" onClick={function(){setSelTender(null);onBack?null:null;}} style={{flexShrink:0}}>← All packages</button>
        </div>
        <div className="page-hdr" style={{marginBottom:12}}>
          <div style={{flex:1}}>
            {/* Title block: the tender sheet reads like a drawing sheet, and the same
                strip heads the printed reports. */}
            {(function(){
              var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
              if(!proc.deliveryDate)return null;
              var src=proc.leadSource;
              var candidates=proc.candidates||[];
              var winner=candidates.find(function(c){return c.key===proc.fabStartSource;})||null;
              return <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:8,
                padding:"7px 11px",borderRadius:8,background:"#faf9f7",border:"1.5px solid var(--rule,#ddd9cf)",fontSize:11}}>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontWeight:700,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".06em",fontSize:10}}>Delivery</span>
                {winner&&<span style={{display:"flex",gap:5,alignItems:"center"}}
                    title={winner.firm?"This is a real recorded date, so everything after it is firm."
                      :"No actual date yet — the chain starts from a target/grace date, so the delivery is provisional."}>
                    <span style={{fontFamily:"var(--font-mono)",fontWeight:700,
                      color:winner.firm?"var(--green,#1e6b3a)":"var(--amber,#b35c00)"}}>{fmtDate(winner.date)}</span>
                    <span className="badge" style={{
                      background:winner.firm?"var(--green-soft,#e6f2e9)":"var(--amber-soft,#fdf1e0)",
                      color:winner.firm?"var(--green,#1e6b3a)":"var(--amber,#b35c00)"}}>{winner.label}</span>
                  </span>}
                <span style={{color:"var(--ink-4,#9b968b)"}}>→</span>
                <span style={{fontFamily:"var(--font-mono)"}}>{fmtDate(proc.fabStart||"")}</span>
                <span style={{color:"var(--ink-4,#9b968b)"}}>fabrication</span>
                <span style={{color:"var(--ink-4,#9b968b)"}}>＋</span>
                <span style={{display:"flex",gap:4,alignItems:"center"}}>
                  <input type="number" min="0" value={td.leadTimeDays||""}
                    onChange={function(e){updTd("leadTimeDays",e.target.value);}}
                    placeholder={String(proc.LEAD)}
                    title="Lead time in days. Leave empty to use the longest material lead time; type a value to override it."
                    style={{width:64,fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 6px",textAlign:"right",
                      borderColor:src==="manual"?"var(--blue,#0f5299)":"var(--rule,#ddd9cf)"}}/>
                  <span style={{color:"var(--ink-4,#9b968b)"}}>days</span>
                </span>
                <span className="badge" style={{
                  background:src==="manual"?"var(--blue-soft,#e8f0fe)":src==="material"?"var(--gold-soft,#faf3e0)":"#eee",
                  color:src==="manual"?"var(--blue,#0f5299)":src==="material"?"var(--gold-ink,#8a6a1e)":"var(--ink-3,#6f6b62)"}}
                  title={src==="manual"?"You typed this lead time; it overrides the materials."
                    :src==="material"?"Longest lead time among this tender's materials"
                    :"No lead time set anywhere — 30 days assumed"}>
                  {src==="manual"?"manual":src==="material"?"from "+(proc.leadMaterial||"material"):"default 30d"}</span>
                <span style={{display:"flex",gap:3,alignItems:"center"}}>
                  <button className={"btn btn-sm"+(src!=="manual"?" btn-pri":"")} style={{padding:"2px 9px",fontSize:10}}
                    title="Use the longest material lead time"
                    onClick={function(){updTd("leadTimeDays","");}}>auto</button>
                  <button className={"btn btn-sm"+(src==="manual"?" btn-pri":"")} style={{padding:"2px 9px",fontSize:10}}
                    title="Type your own lead time, overriding the materials"
                    onClick={function(){if(src!=="manual")updTd("leadTimeDays",String(proc.LEAD||30));}}>manual</button>
                </span>
                <span style={{color:"var(--ink-4,#9b968b)"}}>＝</span>
                <span style={{fontFamily:"var(--font-mono)",fontWeight:700}}>{fmtDate(proc.deliveryDate)}</span>
                <button className="btn btn-sm" style={{marginLeft:"auto",padding:"2px 9px",fontSize:10}}
                  onClick={function(){setShowProcDetail(!showProcDetail);}}>
                  {showProcDetail?"▾ masquer le détail":"▸ voir le détail du calcul"}</button>
              </div>

              {showProcDetail&&<div style={{display:"flex",flexDirection:"column",gap:6,paddingTop:6,borderTop:"1px dashed var(--rule,#ddd9cf)"}}>
                <div style={{fontSize:10,color:"var(--ink-3,#6f6b62)"}}>
                  La date de fabrication retenue est la <strong>plus tardive</strong> des critères ci-dessous (🏆 = celui retenu) :
                </div>
                {candidates.map(function(c){
                  var isWinner=c===winner;
                  return <div key={c.key} style={{padding:"7px 9px",borderRadius:7,
                      background:isWinner?"var(--gold-soft,#faf3e0)":"#fff",
                      border:"1.5px solid "+(isWinner?"var(--gold,#c9a84c)":"var(--rule,#ddd9cf)")}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:3,flexWrap:"wrap"}}>
                      {isWinner&&<span title="Critère retenu pour la fabrication">🏆</span>}
                      <span style={{fontWeight:700,fontSize:11.5}}>{c.label}</span>
                      <span style={{marginLeft:"auto",fontFamily:"var(--font-mono)",fontWeight:700,fontSize:11.5,
                        color:c.firm?"var(--green,#1e6b3a)":"var(--amber,#b35c00)"}}>{c.date?fmtDate(c.date):"—"}</span>
                      <span className="badge" style={{fontSize:9,
                        background:c.firm?"var(--green-soft,#e6f2e9)":"var(--amber-soft,#fdf1e0)",
                        color:c.firm?"var(--green,#1e6b3a)":"var(--amber,#b35c00)"}}>{c.firm?"date réelle":"cible/grâce"}</span>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:10.5,color:"var(--ink-3,#6f6b62)"}}>
                      {c.chain.map(function(step,i){
                        return <span key={i} title={step.note||""} style={{display:"flex",gap:3,alignItems:"center",
                            fontWeight:step.used?700:400, color:step.used?"var(--ink,#16181d)":"inherit",cursor:step.note?"help":"default"}}>
                          {i>0&&<span style={{color:"var(--ink-4,#9b968b)"}}>→</span>}
                          <span>{step.label}:</span>
                          <strong style={{color:step.firm?"var(--green,#1e6b3a)":step.used?"var(--amber,#b35c00)":"inherit"}}>{step.date?fmtDate(step.date):"—"}</strong>
                        </span>;
                      })}
                    </div>
                  </div>;
                })}
              </div>}
              </div>;
            })()}
            {/* Inline fallbacks mirror the .titleblock rules: if index.html has not been
                deployed yet the block still reads as a block, not as stacked plain text. */}
            <div className="titleblock accent" style={{display:"flex",alignItems:"stretch",overflow:"hidden",
              border:"1.5px solid "+(td.cancelled?"var(--amber,#b35c00)":"var(--gold,#c9a84c)"),borderLeftWidth:5,borderRadius:8,
              background:td.cancelled?"#fdf9f2":"#fff",marginBottom:16}}>
              <div className="tb-main" style={{flex:1,minWidth:0,padding:"12px 16px"}}>
                <div className="tb-eyebrow" style={{fontSize:11,fontWeight:600,letterSpacing:".09em",
                  textTransform:"uppercase",color:"#6f6b62",marginBottom:3}}>Package · {td.package||"no department"}</div>
                <input type="text" value={td.title||""} onChange={function(e){updTd("title",e.target.value);}}
                  placeholder="Package title"
                  style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-page)",letterSpacing:"-.01em",
                    border:"none",background:"transparent",outline:"none",width:"100%",padding:0,color:"var(--ink)",lineHeight:1.08}}/>
                <div className="tb-sub" style={{fontSize:12,color:"#6f6b62",marginTop:3,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span>{td.ownerTender||"no owner"}{td.contractor?" · "+td.contractor:""}</span>
                  {(td.awards||[]).filter(function(a){return a.subcontractor;}).map(function(a){
                    var st=awardStatus(a.status);
                    return <span key={a.id} className="badge" title={st.label+(a.scope?" · "+a.scope:"")}
                      style={{background:st.bg,color:st.fg,fontWeight:700}}>{a.status==="signed"?"✓ ":""}{a.subcontractor}</span>;
                  })}
                  {td.cancelled&&<span className="badge" style={{background:"var(--amber-soft,#fdf1e0)",color:"var(--amber,#b35c00)",fontWeight:700}}>
                    ⊘ CANCELLED{td.cancelledAt?" · "+fmtDate(td.cancelledAt):""}</span>}
                  <button className="btn btn-sm" style={{padding:"2px 9px",fontSize:10}}
                    title={td.cancelled
                      ?"Bring this tender back into the totals"
                      :"Keep the tender and its history, but drop it from every budget total. Nothing is deleted."}
                    onClick={function(){
                      if(td.cancelled){
                        if(!safeConfirm("Reinstate “"+(td.title||"this tender")+"”?\n\nIts amounts go back into the package totals."))return;
                        updTd("cancelled",false);
                      }else{
                        if(!safeConfirm("Cancel “"+(td.title||"this tender")+"”?\n\nNothing is deleted: the tender, its steps and its documents stay. It simply stops counting in the budget, proposed, instructed and variance totals, and its row turns orange."))return;
                        // One write: two successive updTd calls rebuild from the same `tenders`
                        // and the second one wiped cancelledAt.
                        updTd({cancelledAt:today(),cancelled:true});
                      }
                    }}>{td.cancelled?"↺ Reinstate":"⊘ Cancel package"}</button>
                </div>
              </div>
              <div className="tb-cells" style={{display:"flex",borderLeft:"1.5px solid var(--gold,#c9a84c)",flexShrink:0}}>
                {(function(){
                  var acc=(td.stepDates||{}).acc||{};
                  var ct=(td.stepDates||{}).contract||{};
                  var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
                  // The ACC verdict can be recorded in either place: the Status column of
                  // the submission table, or the Approval dropdown. Read both.
                  var accSt=acc.approvalStatus||((td.steps||{}).acc)||"";
                  var signed=ct.signedAllDone||ct.signedDone||ct.done||"";
                  var ctState=((td.steps||{}).contract)||"";
                  var aw=(td.awards||[]).filter(function(a){return a.subcontractor;});
                  var cells=[
                    {k:"Awarded to",clip:true,
                      v:aw.length?aw.map(function(a){return (a.status==="signed"?"✓ ":"")+a.subcontractor;}).join(", "):"not awarded",
                      cls:!aw.length?"muted":aw.some(function(a){return a.status==="awarded"||a.status==="signed";})?"green":"",
                      tip:aw.length
                        ?aw.map(function(a){return a.subcontractor+" — "+awardStatus(a.status).label+(a.scope?" · "+a.scope:"");}).join("\n")
                        :"No winner recorded yet. Add it in the Awards panel of this tender."},
                    {k:"ACC",
                      v:accSt&&accSt!=="—"?accSt:"pending",
                      cls:isApprovedStatus(accSt)?"green":/reject|not approved/i.test(accSt)?"red":""},
                    {k:"Contract",
                      v:signed?fmtDate(signed):(ctState&&ctState!=="—"&&ctState!=="N/A"?ctState:"unsigned"),
                      cls:signed||/signed/i.test(ctState)?"green":""},
                    {k:"Delivery",
                      v:proc.deliveryDate?fmtDate(proc.deliveryDate):"needs ACC date",
                      cls:proc.deliveryDate?"":"muted",
                      tip:proc.deliveryDate
                        ?("Fabrication launch "+fmtDate(proc.fabStart||"")+"\n+ "+proc.LEAD+" days lead time"+
                          (proc.leadSource==="manual"?" (typed by hand)":proc.leadSource==="material"?" (longest material: "+(proc.leadMaterial||"—")+")":" (default, no lead time anywhere)")+
                          "\n= delivery "+fmtDate(proc.deliveryDate))
                        :"The whole chain is computed from the ACC submittal date. Fill in the ACC/Aconex target (or its date done) in Submission steps, and this fills itself."},
                    {k:"Start",v:td.startOnSite?fmtDate(td.startOnSite):"no linked task",
                      cls:td.startOnSite?"gold":"muted",
                      tip:td.startOnSite
                        ?"Earliest start week among the schedule tasks linked to this tender."
                        :"Link a schedule task to this tender (📐 panel in a zone schedule) and its start week lands here."},
                    {k:"Margin",
                      v:(proc.margin===undefined||proc.margin===null||proc.margin==="")?"needs both dates":proc.margin+"d",
                      cls:(proc.margin===undefined||proc.margin===null||proc.margin==="")?"muted":Number(proc.margin)<0?"red":"green",
                      tip:"Days between the forecast delivery and the start on site. It needs both a delivery date and a linked schedule task."}
                  ];
                  return cells.map(function(c){
                    var vc=c.cls==="red"?"#b3302a":c.cls==="green"?"#1e6b3a":c.cls==="gold"?"#8a6a1e":c.cls==="muted"?"#9b968b":"#16181d";
                    return <div className="tb-cell" key={c.k} title={c.tip||""} style={{padding:"10px 15px",borderRight:"1px solid #ddd9cf",minWidth:96,cursor:c.tip?"help":"default"}}>
                      <span className="k" style={{display:"block",fontSize:9.5,fontWeight:600,letterSpacing:".09em",
                        textTransform:"uppercase",color:"#6f6b62",marginBottom:2}}>{c.k}</span>
                      <span className={"v "+(c.cls||"")} style={{display:"block",fontSize:c.cls==="muted"?11:13,
                        fontWeight:c.cls==="muted"?500:600,fontStyle:c.cls==="muted"?"italic":"normal",
                        color:vc,whiteSpace:"nowrap",
                        maxWidth:c.clip?230:undefined,overflow:c.clip?"hidden":undefined,textOverflow:c.clip?"ellipsis":undefined}}>{c.v}</span>
                    </div>;
                  });
                })()}
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>DEPT</span>
                <select value={td.package||""} onChange={function(e){updTd("package",e.target.value);}} style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",fontFamily:"inherit"}}>
                  <option value="">—</option>
                  {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>OWNER</span>
                <select value={td.ownerTender||""} onChange={function(e){updTd("ownerTender",e.target.value);}} style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",fontFamily:"inherit"}}>
                  <option value="">—</option>
                  {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>WBS</span>
                <input type="text" value={td.wbs||""} onChange={function(e){updTd("wbs",e.target.value);}} placeholder="WBS-001" style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",width:90}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>CURRENCY</span>
                <select value={td.currency||"EUR"} onChange={function(e){updTd("currency",e.target.value);}} style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",fontFamily:"inherit"}}>
                  {["EUR","USD","GBP","CHF","AED","SAR"].map(function(x){return <option key={x} value={x}>{x}</option>;})}
                </select>
              </div>

              <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>TARGET START</span>
                {(function(){
                  // Driven by the schedules: earliest start week among the tasks linked to this tender.
                  var linked=[];
                  (window._ppSchedules||[]).forEach(function(sc){
                    (sc.rows||[]).forEach(function(r){if(r.tenderRef===td.id&&r.startWeek)linked.push({sc:sc,r:r});});
                  });
                  if(linked.length>0){
                    linked.sort(function(a,b){return a.r.startWeek.localeCompare(b.r.startWeek);});
                    var f=linked[0];
                    return <span onClick={function(){
                        try{
                          lsSet("pp_zone_cur",f.sc.zone||"");lsSet("pp_zone_subtab","schedule");
                          lsSet("pp_sched_selId",f.sc.id);lsSet("pp_sched_focusRow",f.r.id);
                          // breadcrumb so the schedule can send us straight back here
                          lsSet("pp_back_tender",td.id);lsSet("pp_back_label",td.title||"the tender");
                        }catch(e){}
                        if(onNavZone)onNavZone();
                      }}
                      title={"Driven by \""+(f.r.label||"task")+"\" in "+(f.sc.zone||"?")+" ("+f.sc.title+")\nClick to open that task in the schedule."}
                      style={{fontSize:11,fontWeight:800,color:"#00695c",background:"#e8f5e9",border:"1px solid #c8e6c9",borderRadius:5,padding:"2px 8px",cursor:"pointer"}}>
                      🗓 {fmtDate(td.startOnSite||f.r.startWeek)} <span style={{fontSize:9,fontWeight:600,color:"#4caf50"}}>· {f.r.label||"task"} ↗</span>
                    </span>;
                  }
                  return <input type="date" min="1990-01-01" max="2200-12-31" value={td.startOnSite||""} onChange={function(e){updTd("startOnSite",e.target.value);}}
                    title="No schedule task is linked to this tender yet — you can set the date by hand. As soon as a task is linked, the schedule takes over."
                    style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px"}}/>;
                })()}
                {(function(){
                  var proc=calcProcurement(td);
                  var procDelivery=proc.deliveryDate||"";
                  var startOnSite=td.startOnSite||"";
                  if(!procDelivery)return null;
                  var marginDays=startOnSite?(function(){var d1=new Date(procDelivery);var d2=new Date(startOnSite);return Math.round((d2-d1)/(1000*60*60*24));})():null;
                  return <div style={{display:"flex",gap:5,alignItems:"center"}}>
                    <span style={{fontSize:10,color:"#555"}}>→ Procurement delivers: <strong style={{color:marginDays!==null&&marginDays<0?"#c62828":"#2e7d32"}}>{fmtDate(procDelivery)}</strong></span>
                    {marginDays!==null&&<span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:6,background:marginDays<0?"#fce4ec":marginDays<7?"#fff8e1":"#e8f5e9",color:marginDays<0?"#c62828":marginDays<7?"#f57f17":"#2e7d32"}}>{marginDays>0?"+":""}{marginDays}d</span>}
                  </div>;
                })()}
              </div>
              <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:500,fontSize:11}}>
                <input type="checkbox" checked={isReleased} onChange={function(e){updTd("released",e.target.checked);}} style={{width:13,height:13}}/>
                <span style={{color:isReleased?"#2e7d32":"#888"}}>✅ Budget Release</span>
              </label>
            </div>
          </div>
          <button className="btn btn-sm btn-danger" onClick={function(){if(safeConfirm("Delete?"))delTender(td.id);}}>🗑</button>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          <div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f8f7f4"}}>
            <div style={{fontSize:10,color:"#888",marginBottom:2}}>Budget</div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" value={td.budget||""} onChange={function(e){updTd("budget",e.target.value);}} placeholder="0" style={{fontSize:16,fontWeight:800,border:"1px solid #e8e6df",borderRadius:5,background:"#fff",width:"100%",padding:"2px 6px",outline:"none",fontFamily:"inherit"}}/>
              <span style={{fontSize:10,color:"#aaa"}}>{cur}</span>
            </div>
          </div>
          <div className="card" style={{flex:1,minWidth:130,marginBottom:0,padding:"10px 14px",background:"#f0f8ff"}}>
            <div style={{fontSize:10,color:"#1a73e8",marginBottom:2}}>ACC proposed</div>
            <div style={{fontSize:16,fontWeight:800,color:"#1a73e8"}}>{accTotal>0?accTotal.toLocaleString():"—"} {cur}</div>
            <div style={{fontSize:10,color:"#888"}}>Sub {accSub.toLocaleString()} + Other {accOther.toLocaleString()}</div>
          </div>
          <div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f0fff4"}}>
            <div style={{fontSize:10,color:"#2e7d32",marginBottom:2}}>Instructed</div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" value={td.instructionAmount||""} onChange={function(e){updTd("instructionAmount",e.target.value);}} placeholder="0" style={{fontSize:16,fontWeight:800,border:"1px solid #c8e6c9",borderRadius:5,background:"#fff",width:"100%",padding:"2px 6px",outline:"none",fontFamily:"inherit",color:"#2e7d32"}}/>
              <span style={{fontSize:10,color:"#aaa"}}>{cur}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:4,marginTop:4}}>
              <span style={{fontSize:10,color:"#2e7d32",whiteSpace:"nowrap"}}>Instruction no.</span>
              <input type="text" value={td.instructionNumber||""} onChange={function(e){updTd("instructionNumber",e.target.value);}} placeholder="—" title="Instruction number. As soon as it is filled in the package counts as instructed." style={{fontSize:12,fontFamily:"var(--font-mono)",border:"1px solid #c8e6c9",borderRadius:5,background:"#fff",width:"100%",minWidth:0,padding:"2px 6px",outline:"none"}}/>
            </div>
          </div>
          <div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f3e5f5"}}>
            <div style={{fontSize:10,color:"#7b1fa2",marginBottom:2}}>Budget treated</div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" value={td.accAmountTreated||""} onChange={function(e){updTd("accAmountTreated",e.target.value);}} placeholder="0" style={{fontSize:16,fontWeight:800,border:"1px solid #ce93d8",borderRadius:5,background:"#fff",width:"100%",padding:"2px 6px",outline:"none",fontFamily:"inherit",color:"#7b1fa2"}}/>
              <span style={{fontSize:10,color:"#aaa"}}>{cur}</span>
            </div>
            <div style={{fontSize:10,color:"#aaa"}}>Used for the Departments recap (Budget/Cost/Variance treated)</div>
          </div>
          {budget>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:effectiveCost>0&&variance<0?"#fff0f0":effectiveCost>0?"#f0fff4":"#f8f7f4"}}>
            <div style={{fontSize:10,color:effectiveCost>0?(variance<0?"#c62828":"#2e7d32"):"#888",marginBottom:2}}>{effectiveCost>0?varianceLabel:"Variance"}</div>
            <div style={{fontSize:16,fontWeight:800,color:effectiveCost>0?(variance<0?"#c62828":"#2e7d32"):"#bbb"}}>{effectiveCost>0?(variance>0?"+":"")+variance.toLocaleString()+" "+cur:"—"}</div>
            <div style={{fontSize:10,color:"#aaa"}}>{effectiveCost>0?(variance<0?"⚠️ Over budget":"✅ Under budget"):"No cost entered yet"}{effectiveCost>0&&treated===0?" (est.)":""}</div>
          </div>}
          {contractGrand>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#fff8f0"}}>
            <div style={{fontSize:10,color:"#b45309",marginBottom:2}}>Contracts ({linkedContracts.length})</div>
            <div style={{fontSize:16,fontWeight:800,color:"#b45309"}}>{contractGrand.toLocaleString()} {cur}</div>
            <div style={{fontSize:10,color:"#aaa"}}>Base {contractTotal.toLocaleString()} + Add. {addendumTotal.toLocaleString()}</div>
          </div>}
        </div>

        {/* One tab per job. Submissions = every document, edited in one place each;
            Contract = contract circuit + contracts and addendums; Flow = read-only history. */}
        {(function(){
          var nNotes=Array.isArray(td.tenderNotes)?td.tenderNotes.length:(td.notes?1:0);
          var nOpen=linkedTasks.filter(function(t){return t.status!=="done";}).length;
          var ctt=tenderContractTotals(td,contractors);
          var docs=tenderDocs(td);
          var nWait=docs.filter(function(d){var st=docSummary(d).state;return st==="pending"||st==="returned";}).length;
          var TABS=[
            {k:"docs",icon:"📄",l:"Submissions",n:nWait?nWait+" open":"",tip:"Submission chain, WMS & ITP, shop drawings, materials: record each submission and its reference here"},
            {k:"contract",icon:"📋",l:"Contract & addendums",n:ctt.linked.length?ctt.linked.length+" · "+ctt.adCount+" add.":"",tip:"Request, circulation, signature, then the contracts and their addendums"},
            {k:"flow",icon:"📈",l:"Flow & history",n:docs.length?docs.length+" docs":"",tip:"Timeline and read-only register of every document"},
            {k:"actions",icon:"✅",l:"Actions & notes",n:(nOpen?nOpen+" open":"")+(nNotes?(nOpen?" · ":"")+nNotes+" note"+(nNotes>1?"s":""):""),tip:"Next step, linked actions and notes"}
          ];
          return <div className="td-tabs" style={{display:"flex",gap:4,flexWrap:"wrap",margin:"4px 0 12px",borderBottom:"1.5px solid var(--rule,#ddd9cf)",position:"sticky",top:0,zIndex:20,background:"var(--paper,#f4f3f0)",paddingTop:4}}>
            {TABS.map(function(t){
              var on=tdTab===t.k;
              return <button key={t.k} type="button" title={t.tip} onClick={function(){setTdTab(t.k);}}
                style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",border:"none",borderBottom:"3px solid "+(on?"var(--gold,#c9a84c)":"transparent"),
                  marginBottom:-1.5,background:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:on?700:500,color:on?"var(--ink,#16181d)":"var(--ink-3,#6f6b62)"}}>
                <span>{t.icon}</span>{t.l}
                {t.n&&<span style={{fontSize:10,fontWeight:600,padding:"1px 7px",borderRadius:9,background:on?"var(--gold-soft,#faf3e0)":"#eceae4",color:on?"var(--gold-ink,#8a6a1e)":"#6f6b62"}}>{t.n}</span>}
              </button>;
            })}
          </div>;
        })()}

        {tdTab==="docs"&&<React.Fragment>
        <div className="card" style={{marginBottom:10}}>
        <SubmissionSteps part="docs" focus={docFocus} td={td} TENDER_STEPS={TENDER_STEPS} updateStep={updateStep} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} tasks={tasks} saveTasks={saveTasks} pkgOwners={pkgOwners} updTd={updTd} afterSave={flowAfterSave}/>
        </div>

        {(function(){
          var hasSd=td.hasSD||false;
          // Unified SD status (merge legacy submission + approval statuses)
          var sdEff=(function(){
            var app=td.sdApprovalStatus||"";
            var sub=td.sdStatus||"";
            if(app==="approved")return"approved";
            if(app&&app!=="")return"pending approval";
            return sub;
          })();
          var CYCLE_OPTS=["","under preparation","submitted","pending approval","approved","rejected"];
          var CYCLE_LABELS={"":"— Status —","under preparation":"Under preparation","submitted":"Submitted","pending approval":"Pending approval","approved":"✅ Approved","rejected":"❌ Rejected"};
          function sdStatusColor(st){
            if(st==="approved")return"#2e7d32";
            if(st==="rejected")return"#c62828";
            if(st==="pending approval"||st==="submitted")return"#f57f17";
            if(st==="under preparation")return"#1a73e8";
            return"#888";
          }
          function sdStepAction(newStatus){
            if(!saveTasks||!tasks)return;
            var qtag=qualityTag(td.package||"");
            var base="SD — "+td.title;
            var ACTIONS={
              "under preparation":{text:"Prepare the "+base},
              "submitted":{text:"Get approval for "+base},
              "pending approval":{text:"Get approval for "+base},
              "rejected":{text:"Resubmit "+base}
            };
            var allTexts=["Prepare the "+base,"Get approval for "+base,"Resubmit "+base];
            var legacyPrefix="SD to be submitted: "+td.title;
            var owner=(pkgOwners||{})[td.package||""]||td.ownerTender||"";
            var updated=(tasks||[]).map(function(t){
              if(t.tenderRef!==td.id)return t;
              // Match cycle tasks exactly, and the contract-created one by prefix (its text may carry a target date suffix)
              var isCycleTask=allTexts.indexOf(t.text)>=0;
              var isLegacySD=(t.text||"").indexOf(legacyPrefix)===0;
              if((isCycleTask||isLegacySD)&&t.status!=="done"){
                var keepOpen=ACTIONS[newStatus]&&t.text===ACTIONS[newStatus].text;
                if(!keepOpen)return Object.assign({},t,{status:"done",completedAt:today()});
              }
              return t;
            });
            var target=ACTIONS[newStatus];
            if(target){
              var exists=updated.some(function(t){return t.tenderRef===td.id&&t.text===target.text&&t.status!=="done";});
              if(!exists){
                var tgtDate=newStatus==="under preparation"?(td.sdTarget||""):"";
                updated=[newTask({text:target.text,owner:owner,due:tgtDate,tenderRef:td.id,package:td.package||"",importance:2,urgence:2,tags:[qtag],note:"Auto — SD status: "+newStatus,addedBy:"System"}),...updated];
              }
            }
            saveTasks(updated);
          }
          function setSdStatus(val){
            var patch={sdStatus:val};
            patch.sdApprovalStatus=(val==="approved"||val==="pending approval")?val:"";
            // A verdict from the client is a response: record the day it landed so the
            // overdue counter stops.
            if((val==="approved"||val==="rejected")&&!td.sdApprovalDone)patch.sdApprovalDone=today();
            if(val!=="approved"&&val!=="rejected")patch.sdApprovalDone="";
            updTd(patch);
            sdStepAction(val);
          }
          var sdDue14=td.sdDone?(function(){var d=new Date(td.sdDone);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
          // Overdue = we are still waiting. Once the client answers — approved, rejected,
          // or an approval date recorded — the clock stops.
          var sdAnswered=sdEff==="approved"||sdEff==="rejected"||!!td.sdApprovalDone;
          var sdOverdue=!sdAnswered&&sdDue14&&sdDue14<today();
          return <div className="card" style={{marginBottom:10}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:600,fontSize:13,marginBottom:hasSd?10:0}}>
              <input type="checkbox" checked={hasSd} onChange={function(e){updTd("hasSD",e.target.checked);}} style={{width:14,height:14}}/>
              📐 Shop Drawing (SD)
              {!hasSd?null:sdEff&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:8,background:"#e0f2f1",color:sdStatusColor(sdEff),fontWeight:700,marginLeft:4}}>{CYCLE_LABELS[sdEff]||sdEff}</span>}
              {hasSd&&sdOverdue&&<span style={{fontSize:10,color:"#c62828",fontWeight:700}}>⚠️+{workingDaysDiff(sdDue14,today())}d</span>}
            </label>
            {hasSd&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:"8px 10px",background:"#e0f2f122",borderRadius:7,border:"1px solid #00695c33"}}>
              {(function(){
                var sdDocs=tenderDocs(td).filter(function(d){return d.kind==="sd";});
                if(!(td.sdTransmissions||[]).length)return <FlowDocBadge td={td} id="sd:_main"/>;
                var ok=sdDocs.filter(function(d){return docSummary(d).state==="approved";}).length;
                return <span title="Each transmission's revisions are edited in Flow & history → Submissions" style={{fontSize:11,fontWeight:700,color:sdStatusColor(sdEff)}}>
                  {(td.sdTransmissions||[]).length?ok+" / "+sdDocs.length+" transmission"+(sdDocs.length>1?"s":"")+" approved":null}</span>;
              })()}
              <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888",fontWeight:600}}>Target</span><input type="date" min="1990-01-01" max="2200-12-31" value={td.sdTarget||""} onChange={function(e){
                updTd("sdTarget",e.target.value);
                if(e.target.value&&sdEff==="under preparation"&&saveTasks&&tasks){
                  var prepText="Prepare the SD — "+td.title;
                  saveTasks((tasks||[]).map(function(t){return t.tenderRef===td.id&&t.text===prepText&&t.status!=="done"?Object.assign({},t,{due:e.target.value}):t;}));
                }
              }} style={{fontSize:11,padding:"3px 6px",border:"1px solid #00695c44",borderRadius:4}}/></div>
              
              
              
              {sdOverdue&&<span style={{fontSize:10,color:"#c62828",fontWeight:700}}>⚠️ Overdue +{workingDaysDiff(sdDue14,today())}d</span>}
            </div>}
          </div>;
        })()}


      <div className="card" style={{marginBottom:10}}>
        {td.hasSD&&<SDPanel td={td} updTd={updTd} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} people={people} afterSave={flowAfterSave} focus={docFocus}/>}

        {/* Materials sit under the submission chain: their MAR date is derived from the
            contract, which is itself the end of that chain. */}
        <MaterialsPanel td={td} updTd={updTd} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} saveT={saveTasks} tasks={tasks} pkgOwners={pkgOwners} afterSave={flowAfterSave} focus={docFocus}/>
      </div>

      {/* Direct purchases of specific materials, next to (or instead of) the subcontract. */}
      <div className="card" style={{marginBottom:10}}>
        <PurchasesPanel td={td} updTd={updTd} afterSave={flowAfterSave} focus={docFocus}/>
      </div>
        </React.Fragment>}

        {tdTab==="contract"&&<React.Fragment>
        <div className="card" style={{marginBottom:10}}>
        <SubmissionSteps part="contract" td={td} TENDER_STEPS={TENDER_STEPS} updateStep={updateStep} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} tasks={tasks} saveTasks={saveTasks} pkgOwners={pkgOwners} updTd={updTd} afterSave={flowAfterSave}/>
        </div>
        <TenderContractsPanel td={td} contractors={contractors} saveContractors={saveContractors} onOpenContracts={onNavContracts}/>
        <div className="card" style={{marginBottom:10}}>
        {/* One card per subcontractor retained on this tender, with its own contract conditions. */}
        <AwardsPanel td={td} updTd={updTd} contractors={contractors}/>
        </div>
        </React.Fragment>}

        {tdTab==="flow"&&<TenderFlowPanel td={td} updTd={updTd} afterSave={flowAfterSave} onJump={jumpToDoc}/>}

        {tdTab==="actions"&&<React.Fragment>
        <div className="card" style={{marginBottom:10}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#7b1fa2"}}>🎯 Next Step</div>
          <textarea value={td.nextStep||""} onChange={function(e){updTd("nextStep",e.target.value);}} placeholder="Describe the next step or action required for this tender…" style={{width:"100%",minHeight:60,padding:"7px 10px",fontSize:12,border:"1.5px solid #ce93d8",borderRadius:7,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}/>
        </div>

        <div className="card" style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            <div onClick={function(){setLinkedOpen(!linkedOpen);}} title={linkedOpen?"Collapse the actions":"Show the actions"}
              style={{fontWeight:700,fontSize:14,cursor:"pointer",userSelect:"none"}}>
              <span style={{fontSize:10,color:"#9b968b",display:"inline-block",width:14}}>{linkedOpen?"▾":"▸"}</span>
              Linked Actions ({shownLinked.length}{shownLinked.length!==linkedTasks.length?" / "+linkedTasks.length:""})</div>
            {(function(){var nd=linkedTasks.filter(function(t){return t.status==="done";}).length;
              return hideDoneLinked&&nd>0?<button className="btn btn-sm" style={{fontSize:10,padding:"1px 8px"}} onClick={function(){setHideDoneLinked(false);setLinkedOpen(true);}}>
                show {nd} done</button>:null;})()}
            <input type="text" value={qLinked} onChange={function(e){setQLinked(e.target.value);}}
              placeholder="🔎 Search text, owner, tag, status…" style={{flex:1,minWidth:180,maxWidth:340,padding:"4px 9px",fontSize:11}}/>
            {qLinked&&<button className="btn btn-sm" onClick={function(){setQLinked("");}}>✕</button>}
            <label style={{display:"flex",alignItems:"center",gap:4,fontSize:10,textTransform:"none",letterSpacing:"normal",cursor:"pointer",color:"#888",margin:0}}>
              <input type="checkbox" checked={hideDoneLinked} onChange={function(e){setHideDoneLinked(e.target.checked);}} style={{width:12,height:12}}/>
              Hide done
            </label>
          </div>
          {linkedOpen&&(shownLinked.length===0
            ?<div style={{color:"#bbb",fontSize:13}}>{linkedTasks.length?"Every linked action is done.":"No actions linked to this tender yet."}</div>
            :shownLinked.map(function(t){
              return <ActionItem key={t.id} task={t}
                onStatusChange={function(val){saveTasks(tasks.map(function(x){return x.id!==t.id?x:Object.assign({},x,{status:val});}));}}
                onUpdate={function(field,val){saveTasks(tasks.map(function(x){if(x.id!==t.id)return x;var u=stampModified(Object.assign({},x));if(field&&typeof field==="object"){Object.assign(u,field);}else{u[field]=val;}return u;}));}}
                onDelete={function(){saveTasks((tasks||[]).filter(function(x){return x.id!==t.id;}));}}
                people={people} packages={packages} tags={window._ppTags||[]} tenders={tenders} contractors={contractors} onNavTender={null}
                zones={window._ppZones||[]} onOpenRooms={function(tk){setRoomPickTask(tk);}}/>;
            }))}
          {linkedOpen&&<QuickAddTask
            prefill={{tenderRef:td.id, package:td.package||"", owner:td.ownerTender||""}}
            onAdd={function(t){saveTasks([t,...(tasks||[])]);}} people={people}
            tags={window._ppTags||[]} label="Add Task to this tender"
          />}
        </div>


        {(function(){
          var notes=Array.isArray(td.tenderNotes)?td.tenderNotes:(td.notes?[{id:uuid(),title:"Note",content:td.notes}]:[]);
          return <div className="card" style={{marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:notes.length>0?10:0}}>
              <div style={{fontWeight:700,fontSize:13}}>📝 Notes ({notes.length})</div>
              <button className="btn btn-sm" onClick={function(){var ns=[...notes,{id:uuid(),title:"Note "+(notes.length+1),content:"",open:true}];updTd("tenderNotes",ns);}}>＋ Note</button>
            </div>
            {notes.map(function(note,ni){
              function updNote(field,val){var ns=notes.map(function(n,j){return j!==ni?n:Object.assign({},n,{[field]:val});});updTd("tenderNotes",ns);}
              return <div key={note.id||ni} style={{border:"1px solid #e8e6df",borderRadius:8,marginBottom:8,overflow:"hidden"}}>
                <div onClick={function(){updNote("open",!note.open);}} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",cursor:"pointer",background:note.open?"#f8f7f4":"#fff"}}>
                  <span style={{fontSize:12,color:"#aaa"}}>{note.open?"▾":"▸"}</span>
                  <input type="text" value={note.title||""} onChange={function(e){e.stopPropagation();updNote("title",e.target.value);}} onClick={function(e){e.stopPropagation();}} placeholder="Note title..." style={{flex:1,border:"none",background:"transparent",fontWeight:600,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  <button onClick={function(e){e.stopPropagation();if(safeConfirm("Delete note?"))updTd("tenderNotes",notes.filter(function(_,j){return j!==ni;}));}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:12}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
                </div>
                {note.open&&<div style={{padding:"8px 10px",borderTop:"1px solid #f0ede6"}}>
                  <textarea value={note.content||""} onChange={function(e){updNote("content",e.target.value);}} placeholder="Write your note here..." style={{width:"100%",minHeight:80,padding:"6px 8px",fontSize:12,border:"1px solid #e8e6df",borderRadius:6,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}/>
                </div>}
              </div>;
            })}
          </div>;
        })()}

        </React.Fragment>}
      </div>

      {roomPickTask&&<BlockedRoomsModal
        zone={roomPickTask.zone}
        rooms={window._ppRooms||[]}
        selected={roomPickTask.blockedRooms||[]}
        onSave={function(sel){
          saveTasks((tasks||[]).map(function(x){return x.id!==roomPickTask.id?x:stampModified(Object.assign({},x,{blockedRooms:sel}));}));
        }}
        onClose={function(){setRoomPickTask(null);}}/>}
    </div>;
  }

  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Packages</div><div className="page-sub">Submissions, contracts and addendums — by department</div></div>
      <ProcReportButton tenders={tenders} tasks={tasks} packages={packages}/>
      <button className="btn btn-sm" onClick={function(){setShowPrint(true);}} title="Choose the sections to print" style={{marginLeft:"auto"}}>🖨️ Print</button>
      {(function(){
        var n=(tenders||[]).filter(function(t){return tenderGaps(t).length;}).length;
        return <button className="btn btn-sm" onClick={function(){setShowGaps(true);}} title="Every blank of the table, across all packages, to fill in one window"
          style={n?{borderColor:"#f48fb1",color:"#c62828"}:{}}>🧩 Missing info{n?" ("+n+")":""}</button>;
      })()}
      <button className="btn btn-gold" onClick={openNew}>＋ New Package</button>
    </div>
    {showPrint&&<TenderPrintModal onClose={function(){setShowPrint(false);}}
      onPrint={function(o){setShowPrint(false);setTimeout(function(){tenderPrint(o);},50);}}/>}
    {showGaps&&<TenderGapsModal tenders={tenders} saveTenders={saveTenders} packages={packages} people={people}
      onOpenTender={function(t){setShowGaps(false);setSelTender(t);}} onClose={function(){setShowGaps(false);}}/>}
    <div className="tp-noprint" style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <input type="text" value={searchQ} onChange={function(e){setSearchQ(e.target.value);}} placeholder="🔍 Search package, owner..." style={{width:200,padding:"5px 10px",fontSize:12}}/>
      <button className={"fchip"+(pkgFilter==="all"?" on":"")} onClick={function(){setPkgFilter("all");}}>All departments</button>
      {allPkgs.map(function(p){return <button key={p} className={"fchip"+(pkgFilter===p?" on":"")} onClick={function(){setPkgFilter(pkgFilter===p?"all":p);}}>{p}</button>;})}
      {(searchQ||pkgFilter!=="all")&&<button className="btn btn-sm" onClick={function(){setSearchQ("");setPkgFilter("all");}}>✕ Reset</button>}
    </div>
    <div className="tp-noprint" style={{display:"flex",gap:6,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#9b968b",width:70}}>Phase</span>
      {TENDER_PHASES.map(function(p){
        var on=!!phaseSel[p.k];
        return <button key={p.k} className="btn btn-sm" title={on?"Click to hide":"Click to show"}
          onClick={function(){var n=Object.assign({},phaseSel);n[p.k]=!on;setPhaseSel(n);}}
          style={{borderRadius:16,display:"inline-flex",alignItems:"center",gap:6,
            background:on?p.fg:"#fff",color:on?"#fff":"#9b968b",borderColor:on?p.fg:"#d9d5ca",textDecoration:on?"none":"line-through"}}>
          {p.label}<span style={{fontSize:10,opacity:.8,fontWeight:700}}>{phaseCounts[p.k]}</span></button>;
      })}
    </div>
    <div className="tp-noprint" style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#9b968b",width:70}}>Show only</span>
      {[["cl","With client","At least one document waits for the client's answer"],["late","Late delivery","Forecast delivery after the start on site"],["na","Not awarded","No subcontractor recorded in Awards"]].map(function(x){
        var on=quickF===x[0];
        return <button key={x[0]} className={"fchip"+(on?" on":"")} title={x[2]} onClick={function(){setQuickF(on?"":x[0]);}}>{x[1]}</button>;
      })}
      <label style={{marginLeft:"auto",fontSize:11,color:"#6f6b62",display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
        <input type="checkbox" checked={showTl} onChange={function(e){setShowTl(e.target.checked);}} style={{width:"auto",margin:0}}/>timelines</label>
    </div>
    {(function(){
      // A cancelled tender is kept for the record but counts nowhere.
      var releasedTenders=filtered.filter(function(t){return t.released&&!t.cancelled;});
      var totBudget=releasedTenders.reduce(function(s,t){return s+Number(t.budget||0);},0);
      var totAcc=releasedTenders.reduce(function(s,t){return s+Number(t.accAmountSubcontract||0)+Number(t.accAmountOther||0);},0);
      var totInstructed=releasedTenders.reduce(function(s,t){return s+Number(t.instructionAmount||0);},0);
      var totVariance=totBudget-totAcc;
      var totTraite=releasedTenders.reduce(function(s,t){
        var mp=(t.materials||[]).reduce(function(s2,m){return s2+Number(m.proposed||0);},0);
        return s+(mp>0?mp:(Number(t.accAmountSubcontract||0)+Number(t.accAmountOther||0)));
      },0);
      var totRestant=totBudget-totTraite;
      if(!totBudget&&!totAcc&&!totInstructed&&releasedTenders.length===0)return null;
      var totAllBudget=filtered.filter(function(t){return !t.cancelled;}).reduce(function(s,t){return s+Number(t.budget||0);},0);
      var totRemainAwarded=totAllBudget-totBudget;
      return <div className="tp-kpis" style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14,alignItems:"stretch"}}>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px"}}>
          <div style={{fontSize:9,color:"#888",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Total Budget</div>
          <div style={{fontSize:16,fontWeight:800}}>{totAllBudget.toLocaleString()}</div>
          <div style={{fontSize:9,color:"#aaa"}}>{filtered.length} tenders</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:"#e8f5e9"}}>
          <div style={{fontSize:9,color:"#2e7d32",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Total Budget Awarded</div>
          <div style={{fontSize:16,fontWeight:800,color:"#2e7d32"}}>{totBudget.toLocaleString()}</div>
          <div style={{fontSize:9,color:"#aaa"}}>{releasedTenders.length} released</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:"#f0f4ff"}}>
          <div style={{fontSize:9,color:"#3949ab",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Total Proposed</div>
          <div style={{fontSize:16,fontWeight:800,color:"#3949ab"}}>{totAcc>0?totAcc.toLocaleString():"—"}</div>
          <div style={{fontSize:9,color:"#aaa"}}>ACC/ACONEX (released)</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:totVariance<0?"#fff0f0":"#f0fff4",borderLeft:"3px solid "+(totVariance<0?"#c62828":"#2e7d32")}}>
          <div style={{fontSize:9,color:totVariance<0?"#c62828":"#2e7d32",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Variance</div>
          <div style={{fontSize:16,fontWeight:800,color:totVariance<0?"#c62828":"#2e7d32"}}>{(totBudget>0&&totAcc>0)?(totVariance>0?"+":"")+totVariance.toLocaleString():"—"}</div>
          <div style={{fontSize:9,color:"#aaa"}}>Awarded − Proposed</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:totRemainAwarded>0?"#fff8e1":"#f0fff4"}}>
          <div style={{fontSize:9,color:totRemainAwarded>0?"#f57f17":"#2e7d32",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Remain to Award</div>
          <div style={{fontSize:16,fontWeight:800,color:totRemainAwarded>0?"#f57f17":"#2e7d32"}}>{totRemainAwarded.toLocaleString()}</div>
          <div style={{fontSize:9,color:"#aaa"}}>Total − Awarded</div>
        </div>
      </div>;
    })()}
    {filtered.length>0&&<div className="tp-legend"><FlowDocLegend/></div>}
    {filtered.length>0&&listRange&&<div className="tp-legend tp-tl"><TenderTimelineLegend/></div>}
    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">📑</div><div className="empty-txt">No packages found.</div></div>
      :<div className="tp-table" style={{position:"relative"}}><table className="tbl tbl-tenders">
        <thead><tr className="tgroup-hdr">
          {/* One label over each family of columns, so the eye knows where it is in the row. */}
          <th colSpan={6}>Package</th>
          <th colSpan={5} className="tcol-sep">Finance</th>
          <th colSpan={2} className="tcol-sep">Dates</th>
          <th colSpan={TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).length} className="tcol-sep">Submission steps</th>
          <th className="tcol-sep">Follow-up</th>
        </tr><tr>
          <th><span className="tsort" style={{color:sortCol==="status"?"#f97316":undefined}} onClick={function(){toggleSort("status");}} title="Sort by status: before approval → contract phase → signed → cancelled">Status{sortIcon("status")}</span>
            <span style={{color:"#ccc",margin:"0 6px"}}>·</span>
            <span className="tsort" style={{color:sortCol==="title"?"#f97316":undefined}} onClick={function(){toggleSort("title");}}>Package{sortIcon("title")}</span></th>
          <th className="sortable" onClick={function(){toggleSort("package");}}>Department{sortIcon("package")}</th>
          <th style={{minWidth:130}} title="Subcontractor(s) recorded in the tender's Awards panel">Awarded to</th>
          <th style={{minWidth:170}} title="Every document sent to the client: green approved, blue with the client, orange returned to resubmit, dashed not submitted. Contract: green signed, blue under way, dashed not started. Hover for details.">Submissions</th>
          <th style={{minWidth:180}} title="Computed from the dates and statuses entered: the step in progress, who holds it (grey us, orange internal, blue client, purple subcontractor), for how long, and the step after it. The free-text Next Step stays in Follow-up.">Stage</th>
          <th className="sortable" onClick={function(){toggleSort("owner");}}>Owner{sortIcon("owner")}</th>
          <th className="tcol-sep" style={{textAlign:"right"}}>Budget</th>
          <th style={{textAlign:"right"}}>Proposed</th>
          <th style={{textAlign:"right"}}>Instructed</th>
          <th style={{textAlign:"center",minWidth:104}} title="Instruction number. Filled in = the instruction has been received.">Instruction</th>
          <th style={{textAlign:"right",color:"#888"}}>Variance</th>
          <th className="tcol-sep" style={{textAlign:"center",color:"#555",minWidth:90}}>Target start</th>
          <th style={{textAlign:"center",color:"#555",minWidth:110}} title="Delivery forecast. Green on or before the target start, red after it; the gap in days is next to it.">New Starting Date</th>
          {TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).map(function(s,i){
            return <th key={s.key} className={"sortable"+(i===0?" tcol-sep":"")} onClick={function(){toggleSort(s.key);}} title="Sort by how far this step went">{s.label}{sortIcon(s.key)}</th>;
          })}
          <th className="tcol-sep" style={{minWidth:160,color:"#7b1fa2"}}>Next Step</th>
        </tr></thead>
        {listRange&&<tbody className="tp-tl"><tr style={{background:"#fafaf8"}}><td colSpan={99} style={{padding:"3px 10px"}}>
            <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:12,alignItems:"center"}}>
              <span style={{fontSize:10,color:"#9b968b"}}>▸ now · who holds it · since</span><TenderMiniScale range={listRange}/></div></td></tr></tbody>}
          {filtered.map(function(td,rowIdx){
          var steps=td.steps||{};
          var _instr=String(td.instructionNumber||"").trim();
          // Two colours only, one tender in two, so the status line under a tender clearly
          // belongs to it and not to the next one. The state is read from the badges.
          var rowBg=rowIdx%2?"#f7f5ef":"#fff";
          var _ph=TENDER_PHASES.find(function(p){return p.k===tenderPhase(td);});
          var _now=listRange&&!td.cancelled?tenderNow(td):null;
          var _whoCol={us:"#6f6b62",client:"#1a73e8",sub:"#7b1fa2",internal:"#d85a30"};
          var _prev=rowIdx>0?filtered[rowIdx-1]:null;
          var _phaseHead=sortCol==="status"&&(!_prev||tenderPhase(_prev)!==tenderPhase(td));
          var _phaseN=_phaseHead?filtered.filter(function(t){return tenderPhase(t)===_ph.k;}).length:0;
          return <tbody key={td.id} className="tgroup">
          {_phaseHead&&<tr className="tphase-hdr"><td colSpan={99}>
            <span style={{background:_ph.bg,color:_ph.fg,fontWeight:700,borderRadius:8,padding:"2px 10px"}}>{_ph.label}</span>
            <span style={{marginLeft:8,color:"#888"}}>{_phaseN} tender{_phaseN===1?"":"s"}</span></td></tr>}
          <tr style={{cursor:"pointer",background:rowBg}} onClick={function(){setSelTender(td);}}>
            <td style={{fontWeight:600}}>
              {/* Fixed-width badge and dot slot: every tender name starts at the same x. */}
              <div style={{display:"flex",alignItems:"center",gap:6,textAlign:"left"}}>
                <span title={_ph.label} style={{background:_ph.bg,color:_ph.fg,fontSize:9.5,fontWeight:700,borderRadius:8,padding:"1px 6px",whiteSpace:"nowrap",flexShrink:0,width:92,boxSizing:"border-box",textAlign:"center"}}>{_ph.short}</span>
                <span title={td.released?"Released — included in totals":""} style={{width:7,height:7,borderRadius:"50%",background:td.released?"#2e7d32":"transparent",flexShrink:0,display:"inline-block"}}/>
                <span style={{flex:1,minWidth:0}}>{td.title}</span>
              </div>
            </td>
            <td>{td.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{td.package}</span>}</td>
            <td style={{whiteSpace:"nowrap"}}>
              {(function(){
                var aw=(td.awards||[]).filter(function(a){return a.subcontractor;});
                if(!aw.length)return td.contractor
                  ?<span style={{fontSize:11,color:"#888"}} title="From the tender's contractor field, no award recorded yet">{td.contractor}</span>
                  :<span style={{color:"#ddd"}}>—</span>;
                return <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{aw.map(function(a){
                  var st=awardStatus(a.status);
                  return <span key={a.id} className="badge" title={st.label+(a.scope?" · "+a.scope:"")}
                    style={{background:st.bg,color:st.fg,fontWeight:700}}>{a.status==="signed"?"✓ ":""}{a.subcontractor}</span>;
                })}</div>;
              })()}
            </td>
            <td><FlowDocDots td={td}/></td>
            <td style={{verticalAlign:"top"}}><TenderStageCell td={td}/></td>
            <td>{td.ownerTender&&<OwnerChip owner={td.ownerTender}/>}</td>
            <td className="tcol-sep" style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {td.budget?<span style={{fontSize:11,fontWeight:600}}>{Number(td.budget).toLocaleString()}</span>:<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {(Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0))>0
                ?<span style={{fontSize:11,fontWeight:600,color:"#1a73e8"}}>{(Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0)).toLocaleString()}</span>
                :<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {td.instructionAmount?<span style={{fontSize:11,fontWeight:600,color:"#2e7d32"}}>{Number(td.instructionAmount).toLocaleString()}</span>:<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"center",whiteSpace:"nowrap"}} onClick={function(e){e.stopPropagation();}}>
              <input type="text" value={td.instructionNumber||""}
                onChange={function(e){
                  var v=e.target.value;
                  var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{instructionNumber:v});});
                  saveTenders(d);
                }}
                placeholder="—" title="Instruction number. As soon as it is filled in the package counts as instructed."
                style={{width:88,fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 5px",textAlign:"center",
                  border:"1.5px solid "+(_instr?"#c8e6c9":"var(--rule,#ddd9cf)"),background:_instr?"#f2f9f3":"#fff"}}/>
              <div style={{fontSize:10,fontWeight:700,marginTop:2,color:_instr?"var(--green,#1e6b3a)":"var(--ink-4,#9b968b)"}}>
                {_instr?"✓ instructed":"not instructed"}</div>
            </td>
            <td style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {(function(){
                var budget=Number(td.budget||0);
                var proposed=Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0);
                if(!budget||!proposed)return <span style={{color:"#ddd"}}>—</span>;
                var v=budget-proposed;
                return <span style={{fontSize:11,fontWeight:700,color:v<0?"#c62828":"#2e7d32"}}>{v>0?"+":""}{v.toLocaleString()}</span>;
              })()}
            </td>
            <td className="tcol-sep" style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap",color:"#555"}}>
              {td.startOnSite?fmtDate(td.startOnSite):<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap"}}>
              {(function(){var dl=tlDelivery(td,calcProcurement(td));
                if(!dl)return <span style={{color:"#ddd"}}>—</span>;
                return <span title={dl.tip} style={{fontWeight:700,color:dl.col}}>{fmtDate(dl.date)}{dl.gap!==null&&<span style={{marginLeft:6,fontSize:10}}>{dl.label}</span>}</span>;})()}
            </td>
            {TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).map(function(s){
              if(s.key==="contract"){
                var ctc=(td.stepDates||{}).contract||{};
                var CONTRACT_LABELS_LIST=["—","To request","To circulate","To sign","✅ Signed"];
                var CONTRACT_COLORS=["s-default","s-pending","s-pending","s-pending","s-approved-a"];
                var ctAccApproval=((td.stepDates||{}).acc||{}).approval||"";
                var autoReqTarget=ctAccApproval?addWorkingDays(ctAccApproval,getDur("accToRequest")):"";
                var autoCircTarget=ctc.requestDone?addWorkingDays(ctc.requestDone,getDur("requestToCirculate")):"";
                var autoSignAllTarget=ctc.circulateDone?addWorkingDays(ctc.circulateDone,getDur("circulateToSign")):"";
                var stage=0;
                var nextTarget="";
                if(ctc.signedDone||ctc.signedAllDone){stage=4;}
                else if(ctc.circulateDone){stage=3;nextTarget=ctc.signedAllTarget||autoSignAllTarget;}
                else if(ctc.requestDone){stage=2;nextTarget=ctc.circulateTarget||autoCircTarget;}
                else if(ctAccApproval){stage=1;nextTarget=ctc.requestTarget||autoReqTarget;}
                var ctOverdue=stage<4&&nextTarget&&nextTarget<today();
                return <td key="contract" style={{verticalAlign:"top",minWidth:90}}>
                  <span className={"chip "+CONTRACT_COLORS[stage]} style={{fontSize:10,whiteSpace:"nowrap"}}>{CONTRACT_LABELS_LIST[stage]}</span>
                  {stage<4&&nextTarget&&<div style={{fontSize:9,marginTop:2,color:ctOverdue?"#c62828":"#bbb",fontWeight:ctOverdue?700:400}}>
                    {ctOverdue?"⚠️ ":""}{fmtDate(nextTarget)}
                  </div>}
                </td>;
              }
              var v=steps[s.key]||"";var cls=tenderStepClass(s.key,v);
              var dates=(td.stepDates||{})[s.key]||{};
              var done=dates.done||"";
              var target=dates.target||"";
              var isNA=v==="N/A";
              // The kick off meeting counts as held as soon as its date is filled, whatever the status.
              if(s.key==="kickoff"&&!isNA&&done)v="Held";
              var isOverdue=target&&target<today()&&!done&&!v.toLowerCase().includes("approved")&&!isNA;
              var isEmpty=!v||v==="—";
              // A WMS or ITP with no status at all has simply not been done: say it, in red.
              var qualityMissing=(s.key==="wms"||s.key==="itp")&&isEmpty&&!td.cancelled;
              if(s.key==="kickoff")cls=tenderStepClass(s.key,v);
              return <td key={s.key} className={s.key==="pkg"?"tcol-sep":""} style={{verticalAlign:"top",minWidth:90}}>
                {qualityMissing
                  ?<span className="chip s-notdone" style={{fontSize:10,whiteSpace:"nowrap",fontWeight:700}}>Not done</span>
                  :isNA
                  ?<span title="Not applicable — nothing to do" style={{fontSize:10,color:"#2e7d32",fontWeight:700,background:"#e8f5e9",border:"1px solid #c8e6c9",padding:"1px 6px",borderRadius:4}}>N/A</span>
                  :!isEmpty
                  ?<span className={"chip "+cls} style={{fontSize:10,whiteSpace:"nowrap"}}>{v}</span>
                  :!target&&!done
                  ?<span style={{color:"#e8e6df",fontSize:11}}>—</span>
                  :null
                }
                {!isNA&&target&&<div style={{fontSize:9,marginTop:2,color:isOverdue&&!done?"#c62828":"#bbb",fontWeight:isOverdue&&!done?700:400}}>
                  {isOverdue&&!done?"⚠️ ":""}{fmtDate(target)}
                </div>}
                {!isNA&&done&&<div style={{fontSize:9,marginTop:1,color:"#2e7d32",fontWeight:600}}>✓ {fmtDate(done)}</div>}
              </td>;
            })}
            <td className="tcol-sep" style={{minWidth:160,verticalAlign:"top"}} onClick={function(e){e.stopPropagation();}}>
              <textarea value={td.nextStep||""} onChange={function(e){var el=e.target;el.style.height="auto";el.style.height=el.scrollHeight+"px";var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{nextStep:e.target.value});});saveTenders(d);}} ref={function(el){if(el){el.style.height="auto";el.style.height=el.scrollHeight+"px";}}} placeholder="Next step…" rows={1} style={{width:"100%",fontSize:11,padding:"3px 7px",border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",boxSizing:"border-box",resize:"none",overflow:"hidden",lineHeight:1.4,minWidth:160,whiteSpace:"pre-wrap"}}/>
            </td>
          </tr>
          {_now&&<tr className="tp-tl" style={{cursor:"pointer",background:rowBg}} onClick={function(){setSelTender(td);}}>
            <td colSpan={99} style={{paddingTop:0,paddingBottom:6,borderTop:"none"}}>
              <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:12,alignItems:"center"}}>
                <span style={{fontSize:11,color:_whoCol[_now.who]||"#6f6b62",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={_now.text}>
                  ▸ {_now.text}{_now.days!==null&&_now.days>=0?" · "+_now.days+" d":""}<OverdueTag o={_now.overdue}/></span>
                <TenderMiniTimeline td={td} range={listRange}/>
              </div>
            </td>
          </tr>}
          </tbody>;
        })}
        <tfoot>
          <tr style={{background:"#fafaf8",borderTop:"2px solid #e8e6df"}}>
            <td colSpan={99} style={{padding:"8px 12px"}}>
              {(function(){
                var totBudget=filtered.filter(function(t){return !t.cancelled;}).reduce(function(s,t){return s+Number(t.budget||0);},0);
                var totInstructed=filtered.reduce(function(s,t){return s+Number(t.instructionAmount||0);},0);
                var totAccSub=filtered.reduce(function(s,t){return s+Number(t.accAmountSubcontract||0);},0);
                var totAccOther=filtered.reduce(function(s,t){return s+Number(t.accAmountOther||0);},0);
                var totAcc=totAccSub+totAccOther;
                var variance=totBudget-totAcc;
                if(totBudget===0&&totInstructed===0&&totAcc===0)return <span style={{fontSize:11,color:"#aaa"}}>No financial data yet — add Budget and Instruction amounts to tenders.</span>;
                return <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontSize:10,fontWeight:700,color:"#aaa",textTransform:"uppercase",letterSpacing:".5px",marginRight:4}}>TOTALS ({filtered.length})</span>
                  {totBudget>0&&<div style={{padding:"3px 10px",borderRadius:7,background:"#f0ede6",fontSize:11}}><span style={{color:"#888"}}>Budget: </span><strong>{totBudget.toLocaleString()}</strong></div>}
                  {totAcc>0&&<div style={{padding:"3px 10px",borderRadius:7,background:"#e8f0fe",fontSize:11}}><span style={{color:"#888"}}>ACC proposed: </span><strong style={{color:"#1a73e8"}}>{totAcc.toLocaleString()}</strong></div>}
                  {totInstructed>0&&<div style={{padding:"3px 10px",borderRadius:7,background:"#e8f5e9",fontSize:11}}><span style={{color:"#888"}}>Instructed: </span><strong style={{color:"#2e7d32"}}>{totInstructed.toLocaleString()}</strong></div>}
                  {totBudget>0&&totAcc>0&&<div style={{padding:"3px 10px",borderRadius:7,background:variance<0?"#fce4ec":"#e8f5e9",fontSize:11}}><span style={{color:"#888"}}>Variance (B-C): </span><strong style={{color:variance<0?"#c62828":"#2e7d32"}}>{variance>0?"+":""}{variance.toLocaleString()}</strong><span style={{fontSize:10,marginLeft:4}}>{variance<0?"⚠️ over budget":"✅ under budget"}</span></div>}
                </div>;
              })()}
            </td>
          </tr>
        </tfoot>
      </table>{listRange&&<TenderTodayRail range={listRange} dep={filtered.length}/>}</div>}
    
  </div>;
}


function CollapsibleContract({ct,fin,children}){
  const [open,setOpen]=useState(false);
  var currency=ct.currency||"EUR";
  return <div style={{marginBottom:8,border:"1.5px solid #e8e6df",borderRadius:10,overflow:"hidden",background:"#fff"}}>
    <div onClick={function(){setOpen(!open);}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",background:open?"#f8f7f4":"#fff",userSelect:"none"}}>
      <span style={{fontSize:13,color:"#aaa",flexShrink:0,transition:"transform .15s",transform:open?"rotate(0deg)":"rotate(-90deg)",display:"inline-block"}}>{open?"▾":"▾"}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:700,fontSize:13,color:"#1a1a1a"}}>{ct.number||"(no #)"} {ct.sapNumber&&<span style={{fontSize:11,color:"#1a73e8",fontWeight:600,marginLeft:4}}>SAP {ct.sapNumber}</span>}</div>
        {ct.description&&<div style={{fontSize:11,color:"#888",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ct.description}</div>}
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        {ct.closed
          ?<span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#e8f5e9",color:"#2e7d32",fontWeight:700}}>✅ Closed</span>
          :<span style={{fontSize:12,fontWeight:700,color:"#1a1a1a"}}>{fin.total.toLocaleString()} {currency}</span>}
        <div style={{fontSize:10,color:fin.pct>=80?"#2e7d32":"#f57f17"}}>{fin.pct}% certified</div>
        {(function(){
          var certs=ct.certifications||[];
          if(ct.closed||certs.length===0)return null;
          var lastDate=(certs.slice().sort(function(a,b){return (b.date||"").localeCompare(a.date||"");})[0]||{}).date||"";
          if(!lastDate)return null;
          var d=new Date(lastDate);var now=new Date();
          var months=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());
          if(months>=2)return <div style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️ Last cert: {fmtMonthYear(lastDate)}</div>;
          return null;
        })()}
      </div>
    </div>
    {open&&<div style={{borderTop:"1.5px solid #e8e6df",padding:"12px 14px"}} onClick={function(e){e.stopPropagation();}}>{children}</div>}
  </div>;
}

function ContractorsView({contractors,saveContractors,packages,people,tasks,tenders,apiKey,correspondences,saveCorrespondences,saveT,onNavTender,memory,setMemory}){
  const [roomPickTask,setRoomPickTask]=useState(null);
  var ctrs=contractors||[];
  var tnds=tenders||[];
  var pkgs=packages||[];
  var ppl=people||[];
  var tsks=tasks||[];
  var mem=memory||{};
  const [pkgFilter,setPkgFilter]=useState(mem.pkgFilter||"all");
  const [searchQ,setSearchQ]=useState(mem.searchQ||"");
  const [sortCol,setSortCol]=useState(mem.sortCol||"name");
  const [sortDir,setSortDir]=useState(mem.sortDir||"asc");
  const [selCtr,setSelCtr]=useState(mem.selCtrId?(ctrs.find(function(c){return c.id===mem.selCtrId;})||null):null);
  useEffect(function(){if(setMemory)setMemory({pkgFilter:pkgFilter,searchQ:searchQ,sortCol:sortCol,sortDir:sortDir,selCtrId:selCtr?selCtr.id:null});},[pkgFilter,searchQ,sortCol,sortDir,selCtr]);
  const [showForm,setShowForm]=useState(false);
  const [formData,setFormData]=useState(null);
  const [pdfExtracting,setPdfExtracting]=useState(null);
  const [pdfPreview,setPdfPreview]=useState(null);
  const [showImport,setShowImport]=useState(false);

  function toggleSort(col){if(sortCol===col)setSortDir(function(d){return d==="asc"?"desc":"asc";});else{setSortCol(col);setSortDir("asc");}}
  function sortIcon(col){if(sortCol!==col)return " ↕";return sortDir==="asc"?" ↑":" ↓";}

  const allPkgs=[...new Set(ctrs.map(function(c){return c.package;}).filter(Boolean))].sort();
  var filtered=React.useMemo(function(){
    var list=ctrs.filter(function(c){
      if(pkgFilter!=="all"&&c.package!==pkgFilter)return false;
      if(searchQ){var q=searchQ.toLowerCase();if(!(c.name||"").toLowerCase().includes(q)&&!(c.package||"").toLowerCase().includes(q))return false;}
      return true;
    });
    return list.slice().sort(function(a,b){
      var r=0;
      if(sortCol==="package"){r=(a.package||"").localeCompare(b.package||"")||((a.name||"").localeCompare(b.name||""));}
      else if(sortCol==="owner"){r=(a.owner||"").localeCompare(b.owner||"");}
      else{r=(a.name||"").localeCompare(b.name||"");}
      return sortDir==="asc"?r:-r;
    });
  },[ctrs,pkgFilter,searchQ,sortCol,sortDir]);

  function openNew(){var d=newContractor();setFormData(d);setShowForm(true);}
  function openEdit(ctr){setFormData(JSON.parse(JSON.stringify(ctr)));setShowForm(true);}
  function closeForm(){setShowForm(false);setFormData(null);}
  function saveCtr(cd){
    var d=ctrs.find(function(x){return x.id===cd.id;})?ctrs.map(function(x){return x.id===cd.id?cd:x;}):[cd,...ctrs];
    saveContractors(d);closeForm();if(selCtr&&selCtr.id===cd.id)setSelCtr(cd);
  }
  function delCtr(id){if(safeConfirm("Delete subcontractor?"))saveContractors(ctrs.filter(function(c){return c.id!==id;}));setSelCtr(null);}

  function addContract(ctrId){
    var nc=newContract();
    var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:[...(c.contracts||[]),nc]});});
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function updateContract(ctrId,contractId,field,val){
    var d=ctrs.map(function(c){
      if(c.id!==ctrId)return c;
      var newContracts=(c.contracts||[]).map(function(ct){if(ct.id!==contractId)return ct;var u=Object.assign({},ct);u[field]=val;return u;});
      return Object.assign({},c,{contracts:newContracts});
    });
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function addAddendum(ctrId,contractId){
    var ad=newAddendum();
    var d=ctrs.map(function(c){if(c.id!==ctrId)return c;var ncts=(c.contracts||[]).map(function(ct){if(ct.id!==contractId)return ct;return Object.assign({},ct,{addendums:[...(ct.addendums||[]),ad]});});return Object.assign({},c,{contracts:ncts});});
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function addCertification(ctrId,contractId){
    var cf=newCertification();
    var d=ctrs.map(function(c){if(c.id!==ctrId)return c;var ncts=(c.contracts||[]).map(function(ct){if(ct.id!==contractId)return ct;return Object.assign({},ct,{certifications:[...(ct.certifications||[]),cf]});});return Object.assign({},c,{contracts:ncts});});
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function updateAdItem(ctrId,contractId,field,i,key,val){
    var d=ctrs.map(function(c){
      if(c.id!==ctrId)return c;
      var ncts=(c.contracts||[]).map(function(ct){
        if(ct.id!==contractId)return ct;
        var items=(ct[field]||[]).map(function(item,j){if(j!==i)return item;var u=Object.assign({},item);u[key]=val;return u;});
        var u2=Object.assign({},ct);u2[field]=items;return u2;
      });
      return Object.assign({},c,{contracts:ncts});
    });
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }

  var linkedTasks=selCtr?tsks.filter(function(t){return t.contractorRef===selCtr.id;}):[];
  var importUI=showImport?<ContractImportModal contractors={ctrs} packages={pkgs} onClose={function(){setShowImport(false);}}
    onApply={function(res){saveContractors(res.contractors);setShowImport(false);var c=res.contractors.find(function(x){return x.id===res.target.ctrId;});if(c)setSelCtr(c);}}/>:null;

  const [sidebarPkg,setSidebarPkg]=useState("all");
  function updateContract2(ctrId,ctId,field,val){if(field==="__delete__"){var d2=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).filter(function(ct2){return ct2.id!==ctId;})});});saveContractors(d2);if(selCtr&&selCtr.id===ctrId)setSelCtr(d2.find(function(c){return c.id===ctrId;}));return;}var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var u=Object.assign({},ct2);u[field]=val;return u;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function updateAdItem2(ctrId,ctId,field,i,key,val){var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var items=(ct2[field]||[]).map(function(item,j){if(j!==i)return item;var u=Object.assign({},item);u[key]=val;return u;});var u2=Object.assign({},ct2);u2[field]=items;return u2;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function delAdItem2(ctrId,ctId,field,i){var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var u=Object.assign({},ct2);u[field]=(ct2[field]||[]).filter(function(_,j){return j!==i;});return u;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function addAdItem2(ctrId,ctId,field,newItem){var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var u=Object.assign({},ct2);u[field]=[...(ct2[field]||[]),newItem];return u;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function updateCtrField(ctrId,field,val){var d=ctrs.map(function(c){return c.id!==ctrId?c:Object.assign({},c,{[field]:val});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function updateAdvance(ctrId,key,val){var d=ctrs.map(function(c){if(c.id!==ctrId)return c;var ap=Object.assign({amount:"",date:"",note:""},c.advancePayment||{});ap[key]=val;return Object.assign({},c,{advancePayment:ap});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  if(selCtr){
    var ctr=selCtr;
    var linkedTenders=(ctr.tenderRefs||[ctr.tenderRef].filter(Boolean)).map(function(id){return tnds.find(function(t){return t.id===id;});}).filter(Boolean);
    var sortedCtrs=(ctrs||[]).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");});
    return <div className="md-wrap" style={{display:"flex",gap:14,alignItems:"flex-start"}}>

      <div className="md-side" style={{width:180,flexShrink:0,background:"#fff",borderRadius:12,border:"1.5px solid #e8e6df",overflow:"hidden",position:"sticky",top:0,alignSelf:"flex-start"}}>
        <div style={{padding:"8px 10px",borderBottom:"1.5px solid #e8e6df"}}>
          <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",marginBottom:4}}>Subcontractors</div>
          <select value={sidebarPkg||"all"} onChange={function(e){setSidebarPkg(e.target.value);}} style={{width:"100%",padding:"3px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",background:"#fafaf8"}}>
            <option value="all">All packages</option>
            {(pkgs||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
          </select>
        </div>
        <div style={{maxHeight:"75vh",overflowY:"auto"}}>
          {sortedCtrs.filter(function(c2){return sidebarPkg==="all"||c2.package===sidebarPkg;}).map(function(c2){var isActive=c2.id===selCtr.id;return <div key={c2.id} onClick={function(){setSelCtr(c2);}} style={{padding:"7px 10px",cursor:"pointer",background:isActive?"#f0ede6":"transparent",borderLeft:"3px solid "+(isActive?"#c9a84c":"transparent"),fontSize:11,fontWeight:isActive?700:400}}>
            <div style={{color:isActive?"#1c1c1e":"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c2.name}</div>
            {c2.package&&<div style={{fontSize:9,color:"#aaa",marginTop:1}}>{c2.package}</div>}
          </div>;})}
        </div>
      </div>
      <div style={{flex:1,minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
        <button className="btn btn-sm" onClick={function(){setSelCtr(null);}}>← Back</button>
        <div style={{flex:1}}>
          <div className="page-title">{ctr.name}</div>
          <div style={{fontSize:13,color:"#888",marginTop:2,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            {ctr.package&&<span>📦 {ctr.package}</span>}
            {ctr.owner&&<OwnerChip owner={ctr.owner}/>}
            {linkedTenders.map(function(lt){return lt?<span key={lt.id} style={{padding:"2px 8px",borderRadius:10,background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:11,fontWeight:700}}>📑 {lt.title}</span>:null;})}
            {(ctr.advancePayment||{}).date&&<span style={{padding:"2px 8px",borderRadius:10,background:"#e8f5e9",color:"#2e7d32",fontSize:11,fontWeight:700}}>💰 Advance paid {fmtDate(ctr.advancePayment.date)}</span>}
          </div>
        </div>
        <button className="btn btn-sm" onClick={function(){openEdit(ctr);}}>✏️ Edit</button>
        <button className="btn btn-sm btn-danger" onClick={function(){delCtr(ctr.id);}}>🗑</button>
        <button className="btn btn-sm" onClick={function(){setShowImport(true);}} title="Paste the data Claude extracted from a signed contract or addendum">📥 Import</button>
        <button className="btn btn-gold" onClick={function(){addContract(ctr.id);}} style={{marginLeft:"auto"}}>＋ Add Contract</button>
      </div>
      {importUI}

      <div className="card" style={{marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>💰 Advance payment</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
          <label style={{display:"flex",flexDirection:"column",gap:2}}>
            <span style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Amount</span>
            <input type="number" value={(ctr.advancePayment||{}).amount||""} onChange={function(e){updateAdvance(ctr.id,"amount",e.target.value===""?"":Number(e.target.value));}} placeholder="0" style={{padding:"5px 8px",fontSize:12,width:120}}/>
          </label>
          <label style={{display:"flex",flexDirection:"column",gap:2}}>
            <span style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Paid on</span>
            <input type="date" min="1990-01-01" max="2200-12-31" value={(ctr.advancePayment||{}).date||""} onChange={function(e){updateAdvance(ctr.id,"date",e.target.value);}} style={{padding:"5px 8px",fontSize:12}}/>
          </label>
          <label style={{display:"flex",flexDirection:"column",gap:2,flex:1,minWidth:160}}>
            <span style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Note</span>
            <input type="text" value={(ctr.advancePayment||{}).note||""} onChange={function(e){updateAdvance(ctr.id,"note",e.target.value);}} placeholder="e.g. 10% on signature" style={{padding:"5px 8px",fontSize:12,width:"100%",boxSizing:"border-box"}}/>
          </label>
        </div>
        <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>📝 Notes</div>
        <textarea value={ctr.notes||""} onChange={function(e){updateCtrField(ctr.id,"notes",e.target.value);}} placeholder="Any note about this subcontractor…" style={{width:"100%",minHeight:70,padding:"7px 9px",fontSize:12,fontFamily:"inherit",border:"1px solid #e8e6df",borderRadius:6,resize:"vertical",boxSizing:"border-box"}}/>
      </div>

      {(ctr.contracts||[]).length===0&&<div className="empty" style={{padding:"24px 0"}}><div className="empty-ico">📋</div><div className="empty-txt">No contracts yet. Click "＋ Add Contract" to create one.</div></div>}
      {(ctr.contracts||[]).map(function(ct){
        var fin=contractFinancials(ct);
        var linkedTender=ct.tenderRef?(tnds||[]).find(function(t){return t.id===ct.tenderRef;}):null;
        var navFake={ctrId:ctr.id,ctId:ct.id};
        return <CollapsibleContract key={ct.id} ct={ct} fin={fin}>
          <CollapseContractDetail ctr={ctr} ct={ct} fin={fin} linkedTender={linkedTender}
            updateCtField={updateContract2} updateAdItem={updateAdItem2} delAdItem={delAdItem2} addAdItem={addAdItem2}
            tenders={tnds} nav={navFake} setNav={function(){}} saveT={saveT} tasks={tsks} people={ppl} tags={window._ppTags||[]}/>
        </CollapsibleContract>;
      })}

      <CorrespondenceLog ctrId={selCtr.id} ctrName={selCtr.name} correspondences={correspondences||[]} saveCorrespondences={saveCorrespondences} saveT={saveT} tasks={tsks}/>

      <div className="card">
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>Linked Actions ({linkedTasks.length})</div>
        {linkedTasks.length===0
          ?<div style={{color:"#bbb",fontSize:13}}>No actions linked to this subcontractor.</div>
          :linkedTasks.map(function(t){return <ActionItem key={t.id} task={t}
            onStatusChange={function(val){saveT(tsks.map(function(x){return x.id!==t.id?x:Object.assign({},x,{status:val});}));}}
            onUpdate={function(field,val){saveT(tsks.map(function(x){if(x.id!==t.id)return x;var u=stampModified(Object.assign({},x));if(field&&typeof field==="object"){Object.assign(u,field);}else{u[field]=val;}return u;}));}}
            onDelete={function(){saveT((tsks||[]).filter(function(x){return x.id!==t.id;}));}}
            people={ppl} packages={pkgs} tags={window._ppTags||[]} tenders={tnds} contractors={ctrs}
            zones={window._ppZones||[]} onOpenRooms={function(tk){setRoomPickTask(tk);}}/>;} )}
        <QuickAddTask
          prefill={{contractorRef:ctr.id, package:ctr.package||"", owner:ctr.owner||""}}
          onAdd={function(t){saveT([t,...(tsks||[])]);}}
          people={ppl} tags={window._ppTags||[]} label="Add Task to this subcontractor"
        />
      </div>
      {showForm&&formData&&<ContractorFormModal data={formData} onChange={setFormData} onSave={saveCtr} onClose={closeForm} people={ppl} packages={pkgs} tenders={tnds}/>}
      
      </div>
    </div>;
  }

  return <div>
    {roomPickTask&&<BlockedRoomsModal
      zone={roomPickTask.zone}
      rooms={window._ppRooms||[]}
      selected={roomPickTask.blockedRooms||[]}
      onSave={function(sel){saveT((tsks||[]).map(function(x){return x.id!==roomPickTask.id?x:stampModified(Object.assign({},x,{blockedRooms:sel}));}));}}
      onClose={function(){setRoomPickTask(null);}}/>}
    <div className="page-hdr">
      <div><div className="page-title">Subcontractors</div><div className="page-sub">Subcontractors, contracts and certifications</div></div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn" onClick={function(){setShowImport(true);}} title="Paste the data Claude extracted from a signed contract or addendum">📥 Import</button>
        <button className="btn btn-gold" onClick={openNew}>+ New Subcontractor</button>
      </div>
    </div>
    {importUI}
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <input type="text" value={searchQ} onChange={function(e){setSearchQ(e.target.value);}} placeholder="🔍 Search..." style={{width:180,padding:"5px 10px",fontSize:12}}/>
      <button className={"fchip"+(pkgFilter==="all"?" on":"")} onClick={function(){setPkgFilter("all");}}>All packages</button>
      {allPkgs.map(function(p){return <button key={p} className={"fchip"+(pkgFilter===p?" on":"")} onClick={function(){setPkgFilter(pkgFilter===p?"all":p);}}>{p}</button>;})}
      {(searchQ||pkgFilter!=="all")&&<button className="btn btn-sm" onClick={function(){setSearchQ("");setPkgFilter("all");}}>✕ Reset</button>}
    </div>
    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">🤝</div><div className="empty-txt">No subcontractors found.</div></div>
      :<table className="tbl">
        <thead><tr>
          <th className="sortable" onClick={function(){toggleSort("name");}}>Name{sortIcon("name")}</th>
          <th className="sortable" onClick={function(){toggleSort("package");}}>Package{sortIcon("package")}</th>
          <th className="sortable" onClick={function(){toggleSort("owner");}}>Owner{sortIcon("owner")}</th>
          <th>Corresp.</th><th>Linked Tenders</th><th>Contracts</th><th>Total</th><th>Total Instructed</th><th>Certified</th><th>Remaining</th>
        </tr></thead>
        <tbody>{filtered.map(function(ctr){
          var totVal=(ctr.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).total;},0);
          var totCert=(ctr.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).certified;},0);
          var totRem=totVal-totCert;
          var linkedT=(ctr.tenderRefs||[ctr.tenderRef].filter(Boolean)).map(function(id){return tnds.find(function(t){return t.id===id;});}).filter(Boolean);
          var ctrLetters=(correspondences||[]).filter(function(l){return l.ctrId===ctr.id;});
          var unread=ctrLetters.filter(function(l){return l.type==="received"&&!l.replied;}).length;
          return <tr key={ctr.id} style={{cursor:"pointer"}} onClick={function(){setSelCtr(ctr);}}>
            <td style={{fontWeight:700}}>
              {ctr.name}
              {unread>0&&<span style={{marginLeft:6,display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:"50%",background:"#c62828",color:"#fff",fontSize:10,fontWeight:800,verticalAlign:"middle"}} title={unread+" unanswered letter"+(unread>1?"s":"")}>{unread}</span>}
            </td>
            <td>{ctr.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{ctr.package}</span>}</td>
            <td>{ctr.owner&&<OwnerChip owner={ctr.owner}/>}</td>
            <td style={{textAlign:"center"}}>
              {ctrLetters.length>0
                ?<div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                  {unread>0&&<span style={{fontSize:10,fontWeight:700,color:"#c62828"}}>⚠️ {unread} unanswered</span>}
                  <span style={{fontSize:10,color:"#888"}}>{ctrLetters.length} total</span>
                </div>
                :<span style={{color:"#ddd",fontSize:12}}>—</span>}
            </td>
            <td>{linkedT.length>0?<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{linkedT.map(function(lt){return lt?<span key={lt.id} className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {lt.title}</span>:null;})}</div>:<span style={{color:"#ddd"}}>—</span>}</td>
            <td><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{[...new Set((ctr.contracts||[]).map(function(ct){return ct.tenderRef;}).filter(Boolean))].map(function(tid){var td=tnds.find(function(t){return t.id===tid;});return td?<span key={tid} className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {td.title}</span>:null;})}</div></td>
            <td style={{textAlign:"center"}}>{(ctr.contracts||[]).length}</td>
            <td style={{fontWeight:600}}>{totVal.toLocaleString()}</td>
            <td style={{color:"#1a73e8",fontWeight:600}}>{(ctr.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).totalInstructed;},0).toLocaleString()}</td>
            <td style={{color:"#2e7d32",fontWeight:600}}>{totCert.toLocaleString()}</td>
            <td style={{color:totRem<0?"#c62828":"#1a1a1a",fontWeight:600}}>{totRem.toLocaleString()}</td>
          </tr>;
        })}</tbody>
      </table>}
    {showForm&&formData&&<ContractorFormModal data={formData} onChange={setFormData} onSave={saveCtr} onClose={closeForm} people={ppl} packages={pkgs} tenders={tnds}/>}
    
  </div>;
}

function calcProcurement(td){

  var matMaxLead = (td.materials||[]).reduce(function(max,mat){
    var d=parseLeadDays(mat.leadTime||"");return d>max?d:max;
  },0);

  var manualLead = Number(td.leadTimeDays||0);
  var LEAD = manualLead>0 ? manualLead : (matMaxLead>0 ? matMaxLead : 30);
  // Where the lead time came from, so the tender sheet can explain the delivery date
  // instead of showing a number nobody can trace.
  var leadSource = manualLead>0 ? "manual" : (matMaxLead>0 ? "material" : "default");
  var leadMaterial = null;
  (td.materials||[]).forEach(function(mat){
    if(!leadMaterial&&parseLeadDays(mat.leadTime||"")===matMaxLead&&matMaxLead>0)leadMaterial=mat;
  });
  var hasSd = td.hasSD||false;
  var sdResubCount = Number(td.sdResubCount||0);
  // Main SD (no transmissions) whose last revision came back C or D: not approved, whatever
  // sdApprovalDone says (it holds the date of that answer). Transmissions are already handled
  // by _sdAggregate, which leaves sdApprovalDone empty until every one is approved.
  var sdBack = null;
  if(hasSd && !(td.sdTransmissions||[]).length){
    var _sdl = cyclesOfSdMain(td), _sdz = _sdl[_sdl.length-1];
    if(_sdz && (_sdz.code==="C"||_sdz.code==="D")) sdBack = _sdz;
  }

  var accDoneActual = ((td.stepDates||{}).acc||{}).done || "";
  var accSubmittal = accDoneActual || ((td.stepDates||{}).acc||{}).target || "";
  var accApproval = ((td.stepDates||{}).acc||{}).approval||"";
  // contractDone from "Signed contract → Date done" row in the contract section
  var _ct=(td.stepDates||{}).contract||{};
  var contractDone = _ct.signedDone||_ct.signedAllDone||"";

  function addWorkDays(dateStr, days){
    if(!isValidDate(dateStr)) return "";
    var n=Number(days);
    if(!isFinite(n)) return "";
    var d = new Date(dateStr);
    d.setDate(d.getDate()+n);
    return toISO(d);
  }

  // Resolves one gating step to a date: done > future theoretical target > today+7 (grace)
  // when the theoretical target has already passed and nothing is done yet.
  // Used for contract signing and the lead-driving MAR — so the delivery date keeps
  // drifting forward day by day instead of freezing on a missed target.
  function dateOrGrace(done, target){
    if(done) return done;
    var t0 = today();
    if(target && target>=t0) return target;
    return addWorkDays(t0, 7);
  }

  // SD needs its own grace: unlike contract signing or material approval, a missed SD
  // target still has to go through both a submission (1 week) and an approval (2 weeks)
  // before the tender can rely on it, so the grace fallback is 3 weeks, not 1.
  function sdDateOrGrace(done, target){
    if(done) return done;
    var t0 = today();
    if(target && target>=t0) return target;
    return addWorkDays(addWorkDays(t0, 7), 14);
  }

  var steps = [];
  var ov=td.procOverrides||{};

  steps.push({key:"accSub", label:"ACC Submittal", date:accSubmittal, done:accDoneActual, duration:null, manual:true, note:accDoneActual?"From 'Date done' of ACC step":"Provisional — from ACC target date (not yet submitted)"});

  var accApprTargetAuto = addWorkDays(accSubmittal, getDur("accApproval"));
  var accApprTarget = ov.accApp||accApprTargetAuto;
  steps.push({key:"accApp", label:"ACC Approval", date:accApprTarget, done:accApproval, duration:14, manual:false, autoDate:accApprTargetAuto, overridden:!!(ov.accApp&&ov.accApp!==accApprTargetAuto)});

    var contractTargetAuto = addWorkDays(accApproval||accApprTarget, getDur("contractSigning"));
  // La cible saisie à la main dans le tableau Contract (stepDates.contract.signedTarget)
  // est la vraie source de vérité : elle doit primer sur le calcul automatique.
  var contractTarget = _ct.signedTarget||ov.contract||contractTargetAuto;
  steps.push({key:"contract", label:"Contract Signing", date:contractTarget, done:contractDone, duration:28, manual:!!_ct.signedTarget, autoDate:contractTargetAuto, overridden:!!(_ct.signedTarget&&_ct.signedTarget!==contractTargetAuto)||!!(ov.contract&&ov.contract!==contractTargetAuto)});
  // --- fabStart now driven by max(contract, SD approval, lead MAR) instead of contract alone ---
  var contractBase = dateOrGrace(contractDone, contractTarget);
  var fabStart = contractBase;
  var fabStartSource = "contract";

  var sdBase = "";

  if(hasSd){

    var sdSubDate = td.sdDone||(addWorkDays(contractDone||contractTarget, 14));
    var sdSubTargetAuto = addWorkDays(contractDone||contractTarget, getDur("sdAfterContract"));
    // The SD panel's own Target date takes priority over the computed one — a manual entry there
    // is a commitment, so the whole timeline downstream is rebuilt from it.
    // With transmissions, the shop drawings are approved once the LAST one is: the cascade
    // waits for the latest planned submission among those not sent yet (each one's own
    // Target, else the SD panel's, else the computed one), then the latest still with the client.
    var _trs = td.sdTransmissions||[];
    var _trNotSent = _trs.filter(function(t){return !cyclesOfSD(t).length;});
    var _trTarget = _trNotSent.map(function(t){return t.target||td.sdTarget||sdSubTargetAuto;}).filter(isValidDate).sort().pop()||"";
    var _trLastSent = _trs.map(function(t){var l=cyclesOfSD(t),z=l[l.length-1];return z&&!z.code?z.submitted:"";}).filter(isValidDate).sort().pop()||"";
    var sdSubTarget = ov.sdSub||_trTarget||td.sdTarget||sdSubTargetAuto;
    var sdSubDone = _trNotSent.length?"":(_trs.length?(_trLastSent||td.sdDone||""):(td.sdDone||""));
    steps.push({key:"sdSub", label:"SD Submission", date:sdSubTarget, done:sdSubDone, duration:14, manual:false, sd:true, autoDate:sdSubTargetAuto,
      overridden:!!(ov.sdSub&&ov.sdSub!==sdSubTargetAuto),
      fromSdPanel:!ov.sdSub&&(!!_trTarget||!!td.sdTarget)});

    var sdAppTargetAuto = addWorkDays(_trs.length?(sdSubDone||sdSubTarget):(td.sdDone||sdSubTarget), getDur("sdApproval"));
    var sdAppTarget = ov.sdApp||sdAppTargetAuto;
    steps.push({key:"sdApp", label:"SD Approval", date:sdAppTarget, done:td.sdApprovalDone||"", duration:14, manual:false, sd:true,
      review:td.sdReview||"", autoDate:sdAppTargetAuto, overridden:!!(ov.sdApp&&ov.sdApp!==sdAppTargetAuto)});

    var lastSdDate = td.sdApprovalDone||sdAppTarget;
    // Shop drawings returned C or D (main SD, last revision): the return date is an answer,
    // not an approval. The sub reworks and resubmits (14 days after the return, or from
    // today + 7 when that is already past), then the client approves again.
    if(sdBack){
      var _back=isValidDate(sdBack.returned)?sdBack.returned:(td.sdApprovalDone||today());
      var _rs=addWorkDays(_back,14);
      if(_rs<today())_rs=addWorkDays(today(),7);
      var _ra=addWorkDays(_rs,getDur("sdApproval"));
      steps.push({key:"sdResubBack", label:"SD Resubmission (returned "+sdBack.code+")", date:_rs, done:"", duration:14, manual:false, sd:true});
      steps.push({key:"sdReappBack", label:"SD Approval R"+((sdBack.rev||0)+1), date:_ra, done:"", duration:getDur("sdApproval"), manual:false, sd:true});
      lastSdDate=_ra;
    }
    for(var r=0; r<sdResubCount; r++){
      var rSubTarget = addWorkDays(lastSdDate, 14);
      var rAppTarget = addWorkDays(rSubTarget, 14);
      steps.push({key:"sdResub"+(r+1), label:"SD Resubmission "+(r+1), date:rSubTarget, done:"", duration:14, manual:false, sd:true});
      steps.push({key:"sdReapp"+(r+1), label:"SD Approval "+(r+1), date:rAppTarget, done:"", duration:14, manual:false, sd:true});
      lastSdDate = rAppTarget;
    }

    // Grace applies to the normal SD approval step; an open resubmission cascade already
    // pushes lastSdDate forward on its own and is not re-graced here.
    sdBase = sdBack ? lastSdDate : sdDateOrGrace(td.sdApprovalDone, sdAppTarget);
    if(lastSdDate>sdBase) sdBase=lastSdDate;
  }

    // Un MAR marqué "Approved" compte comme validé même si aucune date n'a été saisie :
  // le résultat est acquis, seule la date exacte manque. On ancre alors le calcul sur
  // aujourd'hui plutôt que de laisser dateOrGrace() traiter le MAR comme incertain.
  var marBase = "";
  var marFirmByStatus = false;
  if(leadMaterial){
    var _marApp = leadMaterial.marApprovalStatus||"";
    var _marSub = leadMaterial.marStatus||"";
    var _marApproved = _marApp==="approved"||isApprovedStatus(_marApp)||_marSub==="approved";
    if(leadMaterial.marApprovalDone){
      marBase = leadMaterial.marApprovalDone;
    }else if(_marApproved){
      marBase = today();
      marFirmByStatus = true;
    }else{
      marBase = dateOrGrace("", leadMaterial.marTarget||"");
    }
  }

  if(contractBase && contractBase>fabStart){ fabStart=contractBase; fabStartSource="contract"; }
  if(hasSd && sdBase && sdBase>fabStart){ fabStart=sdBase; fabStartSource="sd"; }
  if(marBase && marBase>fabStart){ fabStart=marBase; fabStartSource="material"; }
  // --- end fabStart change ---

  // Full trace of the three candidate chains, so the tender sheet can show exactly
  // which dates fed into each candidate and which one won (the latest). Each chain
  // separates "target" from "actual/done" and ends on an explicit "→ Retenu" step
  // equal to the candidate's date, with a reason — otherwise a passed target (shown
  // as a plain sub-step) silently differs from the graced date actually used, which
  // read as a bug.
  function graceReason(done,target,doneWord){
    if(done) return doneWord+" — date réelle.";
    var t0=today();
    if(target && target>=t0) return "Cible pas encore échue — utilisée telle quelle.";
    return "Cible dépassée sans date réelle — grâce appliquée à partir d'aujourd'hui.";
  }

  var candidates=[{
    key:"contract", label:"Contract signed / grace", date:contractBase, firm:!!contractDone,
    chain:[
      {label:"ACC submitted", date:accSubmittal, firm:!!accDoneActual},
      {label:"ACC approval", date:accApproval||accApprTarget, firm:!!accApproval},
      {label:"Contract target", date:contractTarget, firm:false},
      {label:"Contract signed (réel)", date:contractDone||"", firm:!!contractDone},
      {label:"→ Retenu", date:contractBase, firm:!!contractDone, used:true,
        note:graceReason(contractDone,contractTarget,"Signé")}
    ]
  }];
  if(hasSd){
    var sdChain=[
      {label:"SD submitted", date:td.sdDone||sdSubTarget, firm:!!td.sdDone},
      {label:"SD approval target", date:sdAppTarget, firm:false},
      {label:sdBack?"SD returned "+sdBack.code+" (réel)":"SD approved (réel)", date:td.sdApprovalDone||"", firm:!!td.sdApprovalDone}
    ];
    if(sdBack)sdChain.push({label:"Resubmission → approval R"+((sdBack.rev||0)+1), date:lastSdDate, firm:false});
    if(sdResubCount>0)sdChain.push({label:"After "+sdResubCount+" resubmission"+(sdResubCount>1?"s":""), date:lastSdDate, firm:false});
    sdChain.push({label:"→ Retenu", date:sdBase, firm:!!td.sdApprovalDone&&!sdBack, used:true,
      note:sdBack?"Retourné "+sdBack.code+" : pas une approbation — resoumission 14j après le retour (ou aujourd'hui +7j si dépassé), puis validation.":graceReason(td.sdApprovalDone,sdAppTarget,"Approuvé")+(td.sdApprovalDone?"":" Grâce SD = aujourd'hui +7j (soumission) +14j (validation).")});
    candidates.push({key:"sd", label:"SD approved / grace", date:sdBase, firm:!!td.sdApprovalDone&&!sdBack, chain:sdChain});
  }
   if(leadMaterial){
    var _marFirm = !!leadMaterial.marApprovalDone||marFirmByStatus;
    var _marNote = leadMaterial.marApprovalDone
      ? graceReason(leadMaterial.marApprovalDone,leadMaterial.marTarget,"Approuvé")
      : marFirmByStatus
        ? "Marqué Approuvé dans Materials, sans date renseignée — date du jour utilisée comme ancre ferme (le résultat est acquis, la date exacte n'a plus d'incidence)."
        : graceReason(leadMaterial.marApprovalDone,leadMaterial.marTarget,"Approuvé");
    candidates.push({key:"material", label:"MAR approved / grace ("+(leadMaterial.name||"material")+")", date:marBase, firm:_marFirm,
      chain:[
        {label:"MAR target", date:leadMaterial.marTarget||"", firm:false},
        {label:"MAR approved (réel)", date:leadMaterial.marApprovalDone||"", firm:!!leadMaterial.marApprovalDone},
        {label:"→ Retenu", date:marBase, firm:_marFirm, used:true, note:_marNote}
      ]});
  }


  steps.push({key:"fab", label:"Fabrication Launch", date:fabStart, done:"", duration:null, manual:false,
    note:"Lead: "+LEAD+"d — driven by "+fabStartSource});

  var deliveryDate = addWorkDays(fabStart, LEAD);
  steps.push({key:"delivery", label:"🚚 Delivery on site", date:deliveryDate, done:"", duration:LEAD, manual:false, highlight:true});

  var startOnSite = td.startOnSite||"";
  var margin = "";
  var procStart = "";
  var totalDays = steps.filter(function(s){return s.duration;}).reduce(function(a,s){return a+(s.duration||0);},0) + LEAD;
  if(startOnSite){
    var sos = new Date(startOnSite);
    var del = deliveryDate ? new Date(deliveryDate) : null;
    margin = del ? Math.round((sos - del)/(1000*60*60*24)) : null;
    var ps = new Date(startOnSite);
    ps.setDate(ps.getDate() - totalDays);
    procStart = toISO(ps);
  }

  return {steps:steps, deliveryDate:deliveryDate, procStart:procStart, margin:margin, totalDays:totalDays, LEAD:LEAD,
    leadSource:leadSource, leadMaterial:leadMaterial?(leadMaterial.name||""):"", fabStart:fabStart, fabStartSource:fabStartSource,
    candidates:candidates};
}

function CollapseContractDetail({ctr,ct,fin,linkedTender,updateCtField,updateAdItem,delAdItem,addAdItem,tenders,nav,setNav,saveT,tasks,people,tags}){
  const [showAdd,setShowAdd]=useState(false);
  const [showCert,setShowCert]=useState(true);
  var addCumul=0;var certCumul=0;
  var effCt=contractEffective(ct);

  return <div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
      <div style={{flex:1}}>
        <div style={{fontSize:11,color:"#888"}}>{ctr.name}</div>
        <div className="page-title" style={{fontSize:18}}>{ct.number||"Contract"} {ct.sapNumber&&<span style={{fontSize:13,color:"#1a73e8",fontWeight:600}}>· SAP {ct.sapNumber}</span>}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:3}}>
          {ct.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>📦 {ct.package}</span>}
          {linkedTender&&<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa"}}>📑 {linkedTender.title}</span>}
        </div>
      </div>
      <button onClick={function(){if(safeConfirm("Delete this contract? This cannot be undone.")){var d=(window._ppContractors||[]).map(function(c){return c.id!==ctr.id?c:Object.assign({},c,{contracts:(c.contracts||[]).filter(function(ct2){return ct2.id!==ct.id;})});});if(updateCtField){updateCtField(ctr.id,ct.id,"__delete__","");if(typeof setNav==="function")setNav(null);}}}} style={{background:"none",border:"1px solid #f5c6c6",borderRadius:6,color:"#c62828",cursor:"pointer",fontSize:11,padding:"4px 10px",fontFamily:"inherit",flexShrink:0}}>🗑 Delete contract</button>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      {[
        {label:"Contract Value excl. tax",val:fin.total.toLocaleString()+" EUR",sub:"Base "+fin.base.toLocaleString()+" + Add. "+fin.addTotal.toLocaleString(),color:"#1a1a1a"},
        {label:"Total Instructed excl. tax",val:fin.totalInstructed.toLocaleString()+" EUR",sub:"",color:"#1a73e8"},
        {label:"Certified excl. tax",val:fin.certified.toLocaleString()+" EUR",sub:fin.pct+"% of contract",color:"#2e7d32"},
        {label:"Remaining excl. tax",val:fin.remaining.toLocaleString()+" EUR",sub:fin.forecast?"Forecast: "+fmtMonthYear(fin.forecast):"",color:fin.remaining<0?"#c62828":"#1a1a1a"}
      ].map(function(k){return <div key={k.label} className="card" style={{flex:1,minWidth:130,marginBottom:0,padding:"10px 14px"}}>
        <div style={{fontSize:10,color:"#888",marginBottom:2}}>{k.label}</div>
        <div style={{fontSize:15,fontWeight:800,color:k.color}}>{k.val}</div>
        {k.sub&&<div style={{fontSize:10,color:"#aaa"}}>{k.sub}</div>}
      </div>;})}
    </div>
    <div className="pbar" style={{height:6,marginBottom:14}}><div className="pfill" style={{width:fin.pct+"%",background:fin.pct>=90?"#c62828":fin.pct>=70?"#f57f17":"#2e7d32"}}/></div>

    <div className="card" style={{marginBottom:10}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Contract Details</div>

      <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{flex:"0 0 130px"}}>
          <label>Contract #</label>
          <input type="text" value={ct.number||""} onChange={function(e){updateCtField(ctr.id,ct.id,"number",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
        </div>
        <div style={{flex:"0 0 120px"}}>
          <label>WBS</label>
          <input type="text" value={ct.wbs||""} onChange={function(e){updateCtField(ctr.id,ct.id,"wbs",e.target.value);}} style={{padding:"4px 8px",fontSize:12}} placeholder="WBS-001"/>
        </div>
        <div style={{flex:"0 0 120px"}}>
          <label>SAP #</label>
          <input type="text" value={ct.sapNumber||""} onChange={function(e){updateCtField(ctr.id,ct.id,"sapNumber",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
        </div>
        <div style={{flex:"0 0 150px"}}>
          <label>Amount excl. tax</label>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <input type="number" value={ct.amount||""} onChange={function(e){updateCtField(ctr.id,ct.id,"amount",e.target.value);}} style={{width:"100%",padding:"4px 32px 4px 8px",fontSize:12,boxSizing:"border-box"}}/>
            <span style={{position:"absolute",right:6,fontSize:10,fontWeight:700,color:"#888",pointerEvents:"none"}}>{ct.currency||"EUR"}</span>
          </div>
        </div>
        <div style={{flex:"0 0 120px"}}>
          <label>INS #</label>
          <input type="text" value={ct.instructionNumber||""} onChange={function(e){updateCtField(ctr.id,ct.id,"instructionNumber",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
        </div>
        <div style={{flex:"0 0 150px"}}>
          <label>INS Amount excl. tax</label>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <input type="number" value={ct.instructionAmount||""} onChange={function(e){updateCtField(ctr.id,ct.id,"instructionAmount",e.target.value);}} style={{width:"100%",padding:"4px 32px 4px 8px",fontSize:12,boxSizing:"border-box"}}/>
            <span style={{position:"absolute",right:6,fontSize:10,fontWeight:700,color:"#888",pointerEvents:"none"}}>{ct.currency||"EUR"}</span>
          </div>
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"0 0 140px"}}>
          <label>Start date</label>
          <input type="date" min="1990-01-01" max="2200-12-31" value={ct.startDate||""} onChange={function(e){updateCtField(ctr.id,ct.id,"startDate",e.target.value);}} style={{padding:"4px 8px",fontSize:11}}/>
        </div>
        <div style={{flex:"0 0 140px"}}>
          <label>{effCt.changedBy.endDate?"End date (as signed)":"End date"}</label>
          <input type="date" min="1990-01-01" max="2200-12-31" value={ct.endDate||""} onChange={function(e){updateCtField(ctr.id,ct.id,"endDate",e.target.value);}} style={{padding:"4px 8px",fontSize:11}}/>
        </div>
        {effCt.changedBy.endDate&&<div style={{flex:"0 0 auto",paddingBottom:6}}>
          <span style={{fontSize:11,fontWeight:700,color:"#7b1fa2"}}>In force: {fmtDate(effCt.endDate)} ({effCt.changedBy.endDate})</span>
        </div>}
        {fin.forecast&&<div style={{flex:"0 0 auto",paddingBottom:6}}>
          <span style={{fontSize:11,color:fin.forecast>(effCt.endDate||"9999")?"#c62828":"#2e7d32",fontWeight:700}}>📅 Forecast: {fmtMonthYear(fin.forecast)}</span>
        </div>}
        <div style={{flex:1,minWidth:160}}>
          <label>Linked Tender</label>
          <select value={ct.tenderRef||""} onChange={function(e){updateCtField(ctr.id,ct.id,"tenderRef",e.target.value);}} style={{padding:"4px 8px",fontSize:11,fontFamily:"inherit"}}>
            <option value="">— none —</option>
            {(tenders||[]).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:1,minWidth:160}}>
          <label>Owner</label>
          <select value={ct.owner||""} onChange={function(e){updateCtField(ctr.id,ct.id,"owner",e.target.value);}} style={{padding:"4px 8px",fontSize:11,fontFamily:"inherit",width:"100%"}}>
            <option value="">— none —</option>
            {(window._ppPeople||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
          </select>
        </div>
        <div style={{flex:2,minWidth:180}}>
          <label>Description</label>
          <input type="text" value={ct.description||""} onChange={function(e){updateCtField(ctr.id,ct.id,"description",e.target.value);}} style={{padding:"4px 8px",fontSize:11,width:"100%",boxSizing:"border-box"}}/>
        </div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"center",padding:"8px 0 0"}}>
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:500,color:"#333"}}>
          <input type="checkbox" checked={!!ct.closed} onChange={function(e){updateCtField(ctr.id,ct.id,"closed",e.target.checked);}} style={{width:15,height:15}}/>
          Contract closed
        </label>
        {ct.closed&&<label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:500,color:"#2e7d32"}}>
          <input type="checkbox" checked={!!ct.cacSigned} onChange={function(e){updateCtField(ctr.id,ct.id,"cacSigned",e.target.checked);}} style={{width:15,height:15}}/>
          Certificate at Completion signed
        </label>}
      </div>
    </div>

    <ContractTermsCard ct={ct}/>

    <div className="card" style={{marginBottom:10}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>ACC / ACONEX Status</div>
      {[
        {key:"acc",label:"ACC",color:"#1a73e8",bg:"#e8f0fe"},
        {key:"aconex",label:"ACONEX",color:"#7b1fa2",bg:"#f3e5f5"}
      ].map(function(doc){
        var signed=ct[doc.key+"Signed"]||false;
        var nc=ctNoClient(ct,doc.key);
        var subDate=nc?"":ct[doc.key+"Date"]||"";
        var status=ct[doc.key+"Status"]||"";
        var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
        var overdue=status!=="approved"&&due14&&due14<today();
        return <div key={doc.key} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 10px",borderRadius:8,background:doc.bg+"44",border:"1px solid "+doc.color+"33",marginBottom:6}}>
          <div style={{flex:"0 0 80px"}}>
            <label style={{color:doc.color,fontSize:11,fontWeight:800,display:"block",marginBottom:4}}>{doc.label}</label>
            <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:11,fontWeight:500}}>
              <input type="checkbox" checked={signed} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"Signed",e.target.checked);}} style={{width:13,height:13}}/>
              Signed
            </label>
          </div>
          <div style={{flex:1}}>
            <label title="Amount below the client's threshold: this document does not go to the client" style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:11,fontWeight:500,color:nc?"#1e6b3a":"#555",marginBottom:4}}>
              <input type="checkbox" checked={nc} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"NoClient",e.target.checked);}} style={{width:13,height:13}}/>
              Not sent to client (amount too low)
            </label>
            {!nc&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
              <select value={status} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"Status",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid "+doc.color+"55",borderRadius:5,fontFamily:"inherit",color:status==="approved"?"#2e7d32":status==="rejected"?"#c62828":"#555",fontWeight:status?"600":"400"}}>
                <option value="">— status —</option>
                <option value="not submitted">Not submitted</option>
                <option value="pending approval">Pending approval</option>
                <option value="rejected">Rejected</option>
                <option value="approved">Approved</option>
              </select>
              {status&&status!=="not submitted"&&<div style={{flex:"0 0 120px"}}>
                <div style={{fontSize:9,fontWeight:700,color:"#888",marginBottom:2}}>SUBMISSION DATE</div>
                <input type="date" min="1990-01-01" max="2200-12-31" value={subDate} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"Date",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid "+doc.color+"55",borderRadius:5}}/>
              </div>}
              {due14&&<div style={{fontSize:10,color:overdue?"#c62828":"#888",fontWeight:overdue?700:400}}>
                {overdue?"⚠️ Overdue +"+workingDaysDiff(due14,today())+"d (due "+fmtDate(due14)+")":"Due: "+fmtDate(due14)}
              </div>}
            </div>}
          </div>
        </div>;
      })}
    </div>

    <div className="card" style={{marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){setShowAdd(!showAdd);}}>
        <div style={{fontWeight:700,fontSize:13}}>Addendums ({(ct.addendums||[]).length}){(ct.addendums||[]).length>0&&<span style={{marginLeft:8,fontSize:11,color:"#1a73e8"}}>Total: {(ct.addendums||[]).reduce(function(s,a){return s+Number(a.amount||0);},0).toLocaleString()} EUR</span>}</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button className="btn btn-sm" onClick={function(e){e.stopPropagation();addAdItem(ctr.id,ct.id,"addendums",newAddendum());}}>+ Add</button>
          <span style={{fontSize:16,color:"#aaa"}}>{showAdd?"▾":"▸"}</span>
        </div>
      </div>
      {showAdd&&<div style={{marginTop:10}}>
        {(ct.addendums||[]).length===0?<div style={{color:"#bbb",fontSize:12}}>No addendums yet.</div>
        :(ct.addendums||[]).map(function(ad,i){
          addCumul+=Number(ad.amount||0);
          return <div key={ad.id} style={{padding:"8px 10px",background:"#fafaf8",borderRadius:7,border:"1px solid #f0ede6",marginBottom:6}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
              <input type="text" value={ad.number||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"number",e.target.value);}} placeholder="Add #" style={{width:80,padding:"3px 6px",fontSize:11,fontWeight:700}}/>
              <input type="text" value={ad.instructionNumber||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"instructionNumber",e.target.value);}} placeholder="INS #" style={{width:80,padding:"3px 6px",fontSize:11}}/>
              <input type="date" min="1990-01-01" max="2200-12-31" value={ad.date||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"date",e.target.value);}} style={{width:130,padding:"3px 6px",fontSize:11}}/>
              <input type="number" value={ad.amount||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"amount",e.target.value);}} placeholder="Amount excl. tax EUR" style={{width:110,padding:"3px 6px",fontSize:11}}/>
<div style={{position:"relative",display:"inline-flex",alignItems:"center"}}><input type="number" value={ad.instructionAmount||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"instructionAmount",e.target.value);}} placeholder="INS Amt" style={{width:110,padding:"3px 28px 3px 6px",fontSize:11}}/><span style={{position:"absolute",right:4,fontSize:9,fontWeight:700,color:"#aaa",pointerEvents:"none"}}>{ct.currency||"EUR"}</span></div>
              <span style={{fontSize:10,color:"#888"}}>Cumul: <strong>{addCumul.toLocaleString()} EUR</strong></span>
              <button onClick={function(){if(safeConfirm("Delete addendum?"))delAdItem(ctr.id,ct.id,"addendums",i);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:14,marginLeft:"auto"}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
            </div>
            <input type="text" value={ad.comment||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"comment",e.target.value);}} placeholder="Comment..." style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box",marginBottom:6}}/>
            {((ad.dateChanges||[]).length>0||ad.scopeChanges)&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
              {(ad.dateChanges||[]).map(function(c,k){var lb=c.field==="startDate"?"Start":c.field==="endDate"?"Completion":c.milestone;return <span key={k} className="badge" style={{background:"#f3e5f5",color:"#7b1fa2",fontSize:10}}>📅 {lb} → {fmtDate(c.to)}</span>;})}
              {ad.scopeChanges&&<span className="badge" style={{background:"#e8f5e9",color:"#2e7d32",fontSize:10}}>📐 Scope{(ad.scopeChanges.added||[]).length?" +"+ad.scopeChanges.added.length:""}{(ad.scopeChanges.removed||[]).length?" −"+ad.scopeChanges.removed.length:""}</span>}
            </div>}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {["acc","aconex"].map(function(dk){
                var dLabel=dk==="acc"?"ACC":"ACONEX";var dColor=dk==="acc"?"#1a73e8":"#7b1fa2";
                var adStatus=ad[dk+"Status"]||"";var nc=ctNoClient(ad,dk);var adDate=nc?"":ad[dk+"Date"]||"";
                var due14=adDate?(function(){var d=new Date(adDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
                var overdue=adStatus!=="approved"&&due14&&due14<today();
                return <div key={dk} style={{display:"flex",gap:5,alignItems:"center",padding:"4px 7px",borderRadius:6,background:dk==="acc"?"#e8f0fe55":"#f3e5f555",border:"1px solid "+dColor+"33",flex:1,minWidth:180}}>
                  <span style={{fontSize:10,fontWeight:700,color:dColor,flexShrink:0}}>{dLabel}</span>
                  <label title="Amount too low: this document does not go to the client" style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:10,fontWeight:500,color:nc?"#1e6b3a":"#6f6b62",flexShrink:0}}>
                    <input type="checkbox" checked={nc} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,dk+"NoClient",e.target.checked);}} style={{width:12,height:12}}/>{nc?"Not sent to client (amount too low)":"No client"}</label>
                  {!nc&&<select value={adStatus} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,dk+"Status",e.target.value);}} style={{fontSize:10,padding:"2px 4px",border:"1px solid "+dColor+"44",borderRadius:4,fontFamily:"inherit",flex:1}}>
                    <option value="">— status —</option>
                    <option value="not submitted">Not submitted</option>
                    <option value="pending approval">Pending approval</option>
                    <option value="rejected">Rejected</option>
                    <option value="approved">✅ Approved</option>
                  </select>}
                  {!nc&&<input type="date" min="1990-01-01" max="2200-12-31" value={adDate} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,dk+"Date",e.target.value);}} style={{fontSize:10,padding:"2px 4px",border:"1px solid "+dColor+"44",borderRadius:4,width:105}}/>}
                  {overdue&&<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(due14,today())}d</span>}
                </div>;
              })}
            </div>
          </div>;
        })}
      </div>}
    </div>

    <div className="card" style={{marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){setShowCert(!showCert);}}>
        <div style={{fontWeight:700,fontSize:13}}>Certifications ({(ct.certifications||[]).length}){(ct.certifications||[]).length>0&&<span style={{marginLeft:8,fontSize:11,color:"#2e7d32"}}>Certified: {(ct.certifications||[]).reduce(function(s,cf){return s+Number(cf.amount||0);},0).toLocaleString()} EUR</span>}</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button className="btn btn-sm" onClick={function(e){e.stopPropagation();addAdItem(ctr.id,ct.id,"certifications",newCertification());}}>+ Add</button>
          <span style={{fontSize:16,color:"#aaa"}}>{showCert?"▾":"▸"}</span>
        </div>
      </div>
      {showCert&&<div style={{marginTop:10}}>
        {(ct.certifications||[]).length===0?<div style={{color:"#bbb",fontSize:12}}>No certifications yet.</div>
        :(ct.certifications||[]).map(function(cf,i){
          certCumul+=Number(cf.amount||0);
          var rem=fin.total-certCumul;
          return <div key={cf.id} style={{padding:"8px 10px",background:"#fafaf8",borderRadius:7,border:"1px solid #f0ede6",marginBottom:6}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
              <input type="text" value={cf.number||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"number",e.target.value);}} placeholder="Cert #" style={{width:80,padding:"3px 6px",fontSize:11,fontWeight:700}}/>
              <input type="month" value={cf.date?cf.date.slice(0,7):""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"date",e.target.value+"-01");}} style={{width:130,padding:"3px 6px",fontSize:11}}/>
              <input type="number" value={cf.amount||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"amount",e.target.value);}} placeholder="Amount excl. tax EUR" style={{width:130,padding:"3px 6px",fontSize:11}}/>
              <span style={{fontSize:10,color:"#2e7d32"}}>Cumul: <strong>{certCumul.toLocaleString()} EUR</strong></span>
              <span style={{fontSize:10,color:rem<0?"#c62828":"#888"}}>Left: <strong>{rem.toLocaleString()} EUR</strong></span>
              <button onClick={function(){if(safeConfirm("Delete certification?"))delAdItem(ctr.id,ct.id,"certifications",i);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:14,marginLeft:"auto"}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
            </div>
            <input type="text" value={cf.comment||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"comment",e.target.value);}} placeholder="Comment..." style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box"}}/>
          </div>;
        })}
      </div>}
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Contract / addendum import.
//
// Claude reads the signed PDF in a chat and returns a JSON block in the
// "pt-contract/1" format. The user pastes it here; nothing is written until
// the review screen is confirmed, and then in ONE saveContractors call.
//
// The contract as signed is never overwritten by an addendum: startDate,
// endDate and milestones stay the original values, and each addendum carries
// its own dateChanges / scopeChanges / amount. The dates in force are derived
// by contractEffective(), exactly as the cumulative amount is derived by
// contractFinancials().
// ---------------------------------------------------------------------------
const CT_IMPORT_FORMAT="pt-contract/1";
const CT_IMPORT_KEYS={
  contract:["format","type","ref","subcontractor","title","priceType","contractDate","signedDate","amount","currency","vat",
    "startDate","endDate","completionLabel","milestones","delayDamages","retentionPct","retentionRelease","advancePayment",
    "performanceSecurity","insurance","defectsPeriodMonths","contractorReps","subcontractorReps","scope","sources"],
  addendum:["format","type","contractRef","no","ref","date","title","amountDelta","statedNewTotal","dateChanges","scopeChanges","sources"]
};
const CT_TERM_KEYS=[
  ["delayDamages","Delay damages"],["retentionPct","Retention %"],["retentionRelease","Retention release"],
  ["advancePayment","Advance payment"],["performanceSecurity","Performance security"],["insurance","Insurance"],
  ["defectsPeriodMonths","Defects period (months)"]
];

function ctIsoOk(s){return typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+"T00:00:00").getTime());}
function ctNorm(s){return String(s||"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();}
function ctAddNo(ad){var m=String((ad&&ad.number)||"").match(/\d+/);return m?parseInt(m[0],10):null;}
function ctDays(a,b){return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000);}

// Parses and validates the pasted text. Returns {data} or {errors:[...]}.
function parseContractImport(text){
  var raw=String(text||"").replace(/```(json)?/gi,"").trim();
  if(!raw)return {errors:["Nothing pasted."]};
  var d;
  try{d=JSON.parse(raw);}catch(e){return {errors:["Not valid JSON: "+e.message]};}
  if(!d||typeof d!=="object"||Array.isArray(d))return {errors:["The JSON must be a single object."]};
  var errs=[];
  if(d.format!==CT_IMPORT_FORMAT)errs.push("Unknown format \""+d.format+"\" (expected "+CT_IMPORT_FORMAT+").");
  var allowed=CT_IMPORT_KEYS[d.type];
  if(!allowed)return {errors:errs.concat(["Unknown type \""+d.type+"\" (expected contract or addendum)."])};
  Object.keys(d).forEach(function(k){if(allowed.indexOf(k)<0)errs.push("Unknown field \""+k+"\".");});
  function num(k,req){var v=d[k];if(v==null){if(req)errs.push("Missing "+k+".");return;}if(typeof v!=="number"||!isFinite(v))errs.push(k+" must be a number.");}
  function date(k,req){var v=d[k];if(v==null){if(req)errs.push("Missing "+k+".");return;}if(!ctIsoOk(v))errs.push(k+" must be a YYYY-MM-DD date.");}
  function str(k,req){var v=d[k];if(v==null){if(req)errs.push("Missing "+k+".");return;}if(typeof v!=="string")errs.push(k+" must be text.");}
  if(d.type==="contract"){
    str("ref",true);str("subcontractor",true);str("title");str("priceType");str("currency");str("vat");str("completionLabel");
    ["delayDamages","retentionRelease","advancePayment","performanceSecurity","insurance"].forEach(function(k){str(k);});
    num("amount");num("retentionPct");num("defectsPeriodMonths");
    ["contractDate","signedDate","startDate","endDate"].forEach(function(k){date(k);});
    if(d.milestones!=null){
      if(!Array.isArray(d.milestones))errs.push("milestones must be a list.");
      else d.milestones.forEach(function(m,i){if(!m||typeof m.label!=="string")errs.push("Milestone "+(i+1)+": label missing.");else if(m.date!=null&&!ctIsoOk(m.date))errs.push("Milestone \""+m.label+"\": bad date.");});
    }
    ["contractorReps","subcontractorReps"].forEach(function(k){if(d[k]!=null&&!(Array.isArray(d[k])&&d[k].every(function(x){return typeof x==="string";})))errs.push(k+" must be a list of names.");});
    if(d.scope!=null){
      if(typeof d.scope!=="object")errs.push("scope must be an object.");
      else if(d.scope.items!=null&&!(Array.isArray(d.scope.items)&&d.scope.items.every(function(x){return typeof x==="string";})))errs.push("scope.items must be a list of text.");
    }
  }else{
    str("contractRef",true);str("ref");str("title");date("date");num("amountDelta");num("statedNewTotal");
    if(typeof d.no!=="number"||d.no<1||Math.floor(d.no)!==d.no)errs.push("no must be the addendum number (1, 2, 3…).");
    if(d.dateChanges!=null){
      if(!Array.isArray(d.dateChanges))errs.push("dateChanges must be a list.");
      else d.dateChanges.forEach(function(c,i){
        if(!c||(!c.field&&!c.milestone))errs.push("Date change "+(i+1)+": needs field or milestone.");
        else if(c.field&&c.field!=="startDate"&&c.field!=="endDate")errs.push("Date change "+(i+1)+": field must be startDate or endDate.");
        if(c&&!ctIsoOk(c.to))errs.push("Date change "+(i+1)+": \"to\" must be a YYYY-MM-DD date.");
        if(c&&c.from!=null&&!ctIsoOk(c.from))errs.push("Date change "+(i+1)+": bad \"from\" date.");
      });
    }
    if(d.scopeChanges!=null&&typeof d.scopeChanges!=="object")errs.push("scopeChanges must be an object.");
  }
  return errs.length?{errors:errs}:{data:d};
}

// Dates and scope in force: the contract as signed, then each addendum in order.
function contractEffective(ct){
  var eff={startDate:ct.startDate||"",endDate:ct.endDate||"",
    milestones:(ct.milestones||[]).map(function(m){return {label:m.label,date:m.date||"",original:m.date||"",changedBy:null};}),
    changedBy:{startDate:null,endDate:null},scopeAdded:[],scopeRemoved:[],extensionDays:0};
  var ads=(ct.addendums||[]).slice().sort(function(a,b){
    var na=ctAddNo(a),nb=ctAddNo(b);
    if(na!=null&&nb!=null&&na!==nb)return na-nb;
    return (a.date||"").localeCompare(b.date||"");
  });
  ads.forEach(function(ad){
    var tag=ad.number?("Add. "+ad.number):"Addendum";
    (ad.dateChanges||[]).forEach(function(c){
      if(!c||!c.to)return;
      if(c.field==="startDate"||c.field==="endDate"){eff[c.field]=c.to;eff.changedBy[c.field]=tag;return;}
      if(c.milestone){
        var k=ctNorm(c.milestone);
        var m=eff.milestones.find(function(x){return ctNorm(x.label)===k;});
        if(m){m.date=c.to;m.changedBy=tag;}
        else eff.milestones.push({label:c.milestone,date:c.to,original:"",changedBy:tag});
      }
    });
    var sc=ad.scopeChanges||{};
    (sc.added||[]).forEach(function(x){eff.scopeAdded.push({text:x,by:tag});});
    (sc.removed||[]).forEach(function(x){eff.scopeRemoved.push({text:x,by:tag});});
  });
  if(ct.endDate&&eff.endDate&&eff.endDate!==ct.endDate)eff.extensionDays=ctDays(ct.endDate,eff.endDate);
  return eff;
}

function ctFindContract(contractors,ref){
  var k=ctNorm(ref);var hit=null;
  (contractors||[]).forEach(function(c){(c.contracts||[]).forEach(function(ct){if(!hit&&ctNorm(ct.number)===k)hit={ctr:c,ct:ct};});});
  return hit;
}
function ctMatchContractor(contractors,name){
  var k=ctNorm(name);if(!k)return null;
  var list=contractors||[];
  var exact=list.find(function(c){return ctNorm(c.name)===k;});
  if(exact)return exact;
  var strip=function(s){return ctNorm(s).replace(/\b(BRANCH OF|LLC|S ?A|SA|LTD|LIMITED|IKE|EPE|OE|EE|CONTRACTING|CONSTRUCTION|CONSTRUCTIONS|COMPANY|CO)\b/g," ").replace(/\s+/g," ").trim();};
  var ks=strip(name);
  var near=list.filter(function(c){var cs=strip(c.name);return cs&&ks&&(cs===ks||cs.indexOf(ks)>=0||ks.indexOf(cs)>=0);});
  return near.length===1?near[0]:null;
}

// Builds what the review screen shows. Pure: reads only.
function planContractImport(d,contractors){
  var plan={type:d.type,data:d,rows:[],warnings:[],blocking:[]};
  function row(key,label,oldV,newV,fmt){
    if(newV==null||newV===""||(Array.isArray(newV)&&!newV.length))return;
    var o=oldV==null?"":oldV;
    var same=JSON.stringify(o)===JSON.stringify(newV)||(typeof newV==="number"&&Number(o)===newV);
    plan.rows.push({key:key,label:label,old:o,val:newV,fmt:fmt||"",same:same,conflict:!same&&o!==""&&!(Array.isArray(o)&&!o.length)});
  }
  if(d.type==="contract"){
    var hit=ctFindContract(contractors,d.ref);
    plan.existing=hit;
    plan.ctrId=hit?hit.ctr.id:((ctMatchContractor(contractors,d.subcontractor)||{}).id||"__new__");
    var ct=hit?hit.ct:{};
    var terms=ct.terms||{};
    row("number","Contract #",ct.number,d.ref);
    row("description","Title",ct.description,d.title);
    row("amount","Amount excl. tax",ct.amount===""||ct.amount==null?"":Number(ct.amount),d.amount,"money");
    row("currency","Currency",ct.currency,d.currency);
    row("priceType","Price type",ct.priceType,d.priceType);
    row("contractDate","Contract date",ct.contractDate,d.contractDate,"date");
    row("signedDate","Signed on",ct.signedDate,d.signedDate,"date");
    row("startDate","Start date",ct.startDate,d.startDate,"date");
    row("endDate","End date",ct.endDate,d.endDate,"date");
    row("completionLabel","Completion defined as",ct.completionLabel,d.completionLabel);
    row("milestones","Key milestones",(ct.milestones||[]).map(function(m){return {label:m.label,date:m.date};}),(d.milestones||[]).map(function(m){return {label:m.label,date:m.date||""};}),"milestones");
    CT_TERM_KEYS.forEach(function(t){row("terms."+t[0],t[1],terms[t[0]],d[t[0]]);});
    row("reps.contractor","Contractor's reps",(ct.reps||{}).contractor,d.contractorReps,"list");
    row("reps.subcontractor","Subcontractor's reps",(ct.reps||{}).subcontractor,d.subcontractorReps,"list");
    row("scope","Scope of works",ct.scope||null,d.scope&&(d.scope.summary||(d.scope.items||[]).length)?{summary:d.scope.summary||"",items:d.scope.items||[]}:null,"scope");
    if(hit&&(hit.ct.addendums||[]).some(function(a){return (a.dateChanges||[]).length;})&&plan.rows.some(function(r){return (r.key==="startDate"||r.key==="endDate"||r.key==="milestones")&&r.conflict;}))
      plan.warnings.push("This contract already has addendums that change its dates. Changing the original dates shifts the baseline they apply to.");
    if(hit&&ctNorm(hit.ctr.name)!==ctNorm(d.subcontractor))
      plan.warnings.push("Contract "+d.ref+" already exists under \""+hit.ctr.name+"\", the document names \""+d.subcontractor+"\". It stays where it is.");
  }else{
    var h=ctFindContract(contractors,d.contractRef);
    if(!h){plan.blocking.push("No contract numbered "+d.contractRef+" in the app. Import the contract first, or fix its number.");return plan;}
    plan.existing=h;plan.ctrId=h.ctr.id;
    var ads=h.ct.addendums||[];
    var nums=ads.map(ctAddNo).filter(function(n){return n!=null;});
    if(nums.indexOf(d.no)>=0)plan.blocking.push("Addendum "+d.no+" is already recorded on "+(h.ct.number||d.contractRef)+".");
    for(var n=1;n<d.no;n++){if(nums.indexOf(n)<0){plan.warnings.push("Addendum "+n+" is not recorded yet: numbering has a gap.");break;}}
    var fin=contractFinancials(h.ct);
    plan.totalBefore=fin.total;
    if(d.amountDelta!=null){
      plan.totalAfter=fin.total+d.amountDelta;
      if(d.statedNewTotal!=null&&Math.abs(d.statedNewTotal-plan.totalAfter)>0.5)
        plan.warnings.push("The addendum states a new total of "+d.statedNewTotal.toLocaleString()+", the app computes "+plan.totalAfter.toLocaleString()+" (difference "+(d.statedNewTotal-plan.totalAfter).toLocaleString()+"). An earlier addendum may be missing or mistyped.");
    }
    var eff=contractEffective(h.ct);
    plan.changes=(d.dateChanges||[]).map(function(c){
      var cur;
      if(c.field)cur=eff[c.field]||"";
      else{var m=eff.milestones.find(function(x){return ctNorm(x.label)===ctNorm(c.milestone);});cur=m?m.date:null;}
      var label=c.field==="startDate"?"Start date":c.field==="endDate"?"End date":c.milestone;
      var w="";
      if(cur===null)w="Milestone not found on the contract: it will be added.";
      else if(c.from&&cur&&c.from!==cur)w="The addendum says it was "+c.from+", the app has "+cur+" in force.";
      return {change:c,label:label,current:cur||"",warn:w};
    });
    plan.changes.forEach(function(x){if(x.warn)plan.warnings.push(x.label+": "+x.warn);});
  }
  return plan;
}

// Returns the new contractors array. One call, one write.
function applyContractImport(plan,sel,contractors,opts){
  var d=plan.data;opts=opts||{};
  var list=(contractors||[]).slice();
  var target={ctrId:null,ctId:null};
  if(d.type==="contract"){
    var ctrId=opts.ctrId||plan.ctrId;
    if(ctrId==="__new__"){
      var nc=Object.assign(newContractor(),{name:d.subcontractor,package:opts.package||""});
      list=[nc].concat(list);ctrId=nc.id;
    }
    var existingId=plan.existing?plan.existing.ct.id:null;
    list=list.map(function(c){
      var isOwner=existingId?(c.contracts||[]).some(function(x){return x.id===existingId;}):c.id===ctrId;
      if(!isOwner)return c;
      var base=existingId?(c.contracts||[]).find(function(x){return x.id===existingId;}):Object.assign(newContract(),{package:opts.package||c.package||""});
      var ct=Object.assign({},base);
      ct.terms=Object.assign({},base.terms||{});
      ct.reps=Object.assign({},base.reps||{});
      plan.rows.forEach(function(r){
        if(!sel[r.key]||r.same)return;
        if(r.key.indexOf("terms.")===0)ct.terms[r.key.slice(6)]=r.val;
        else if(r.key==="reps.contractor")ct.reps.contractor=r.val;
        else if(r.key==="reps.subcontractor")ct.reps.subcontractor=r.val;
        else if(r.key==="milestones")ct.milestones=r.val.map(function(m){return {id:uid(),label:m.label,date:m.date};});
        else ct[r.key]=r.val;
      });
      if(!existingId&&opts.package)ct.package=opts.package;
      ct.importSources=d.sources||null;ct.importedAt=today();
      target={ctrId:c.id,ctId:ct.id};
      var cs=existingId?(c.contracts||[]).map(function(x){return x.id===existingId?ct:x;}):(c.contracts||[]).concat([ct]);
      return Object.assign({},c,{contracts:cs});
    });
  }else{
    var h=plan.existing;
    var ad=Object.assign(newAddendum(),{
      number:String(d.no),ref:d.ref||"",date:d.date||"",
      amount:sel.amount&&d.amountDelta!=null?d.amountDelta:"",
      comment:d.title||((d.scopeChanges||{}).summary)||"",
      statedNewTotal:d.statedNewTotal!=null?d.statedNewTotal:null,
      dateChanges:sel.dates?(d.dateChanges||[]).map(function(c){var o={to:c.to,from:c.from||""};if(c.field)o.field=c.field;else o.milestone=c.milestone;return o;}):[],
      scopeChanges:sel.scope&&d.scopeChanges?{summary:d.scopeChanges.summary||"",added:d.scopeChanges.added||[],removed:d.scopeChanges.removed||[]}:null,
      importSources:d.sources||null,importedAt:today()
    });
    list=list.map(function(c){
      if(c.id!==h.ctr.id)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(x){return x.id!==h.ct.id?x:Object.assign({},x,{addendums:(x.addendums||[]).concat([ad])});})});
    });
    target={ctrId:h.ctr.id,ctId:h.ct.id};
  }
  return {contractors:list,target:target};
}

function ctFmtVal(v,fmt){
  if(v==null||v==="")return "—";
  if(fmt==="money")return Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  if(fmt==="date")return fmtDate(v);
  if(fmt==="milestones")return v.map(function(m){return m.label+(m.date?" — "+fmtDate(m.date):"");}).join("\n");
  if(fmt==="list")return v.join(", ");
  if(fmt==="scope")return (v.summary||"")+((v.items||[]).length?"\n"+v.items.map(function(x){return "• "+x;}).join("\n"):"");
  return String(v);
}

function ContractImportModal({contractors,packages,onApply,onClose}){
  const [text,setText]=useState("");
  const [errors,setErrors]=useState([]);
  const [plan,setPlan]=useState(null);
  const [sel,setSel]=useState({});
  const [ctrChoice,setCtrChoice]=useState("");
  const [pkgChoice,setPkgChoice]=useState("");

  function analyse(){
    var r=parseContractImport(text);
    if(r.errors){setErrors(r.errors);setPlan(null);return;}
    var p=planContractImport(r.data,contractors);
    var s={};
    if(p.type==="contract")p.rows.forEach(function(row){if(!row.same)s[row.key]=true;});
    else{s.amount=r.data.amountDelta!=null;s.dates=(r.data.dateChanges||[]).length>0;s.scope=!!r.data.scopeChanges;}
    var ctr=(contractors||[]).find(function(c){return c.id===p.ctrId;});
    setErrors([]);setPlan(p);setSel(s);setCtrChoice(p.ctrId||"__new__");setPkgChoice(ctr?(ctr.package||""):"");
  }
  function apply(){
    if(!plan||plan.blocking.length)return;
    var res=applyContractImport(plan,sel,contractors,{ctrId:ctrChoice,package:pkgChoice});
    onApply(res);
  }
  function tog(k){setSel(Object.assign({},sel,{[k]:!sel[k]}));}

  var d=plan&&plan.data;
  var nChanges=plan?(plan.type==="contract"?plan.rows.filter(function(r){return !r.same&&sel[r.key];}).length:(sel.amount?1:0)+(sel.dates?1:0)+(sel.scope?1:0)):0;
  var cellS={padding:"6px 8px",borderBottom:"1px solid #f0ede6",verticalAlign:"top",fontSize:12,whiteSpace:"pre-wrap"};
  var hS={padding:"6px 8px",fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:".05em",textAlign:"left",borderBottom:"1.5px solid #e8e6df"};
  var secS={fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:".06em",margin:"14px 0 6px"};

  return <div className="overlay" onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:900,width:"95vw"}}>
      <div className="modal-hdr">
        <div className="modal-title">📥 Import contract data</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
      </div>
      <div className="modal-body" style={{maxHeight:"72vh",overflowY:"auto"}}>
        {!plan&&<div>
          <div style={{fontSize:12,color:"#666",marginBottom:8}}>Paste the <code>{CT_IMPORT_FORMAT}</code> block Claude produced from the signed contract or addendum. Nothing is saved before you confirm.</div>
          <textarea value={text} onChange={function(e){setText(e.target.value);}} rows={16} placeholder={'{ "format": "'+CT_IMPORT_FORMAT+'", "type": "contract", … }'}
            style={{width:"100%",boxSizing:"border-box",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,padding:8,border:"1px solid #e8e6df",borderRadius:6}}/>
          {errors.length>0&&<div style={{marginTop:8,padding:"8px 10px",background:"#fce4ec",borderRadius:6,color:"#c62828",fontSize:12}}>
            {errors.map(function(e,i){return <div key={i}>• {e}</div>;})}
          </div>}
        </div>}

        {plan&&<div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:6}}>
            <span className="badge" style={{background:plan.type==="contract"?"#e8f0fe":"#f3e5f5",color:plan.type==="contract"?"#1a73e8":"#7b1fa2",fontWeight:700}}>
              {plan.type==="contract"?(plan.existing?"Update contract":"New contract"):"Addendum "+d.no}
            </span>
            <strong style={{fontSize:14}}>{plan.type==="contract"?d.ref:(plan.existing?plan.existing.ct.number:d.contractRef)}</strong>
            {plan.existing&&<span style={{fontSize:12,color:"#888"}}>· {plan.existing.ctr.name}</span>}
            {plan.type==="addendum"&&d.date&&<span style={{fontSize:12,color:"#888"}}>· dated {fmtDate(d.date)}</span>}
            {plan.type==="addendum"&&d.ref&&<span style={{fontSize:12,color:"#888"}}>· {d.ref}</span>}
          </div>

          {plan.blocking.map(function(b,i){return <div key={"b"+i} style={{padding:"8px 10px",background:"#fce4ec",borderRadius:6,color:"#c62828",fontSize:12,fontWeight:600,marginBottom:6}}>⛔ {b}</div>;})}
          {plan.warnings.map(function(w,i){return <div key={"w"+i} style={{padding:"8px 10px",background:"#fff3e0",borderRadius:6,color:"#ef6c00",fontSize:12,marginBottom:6}}>⚠️ {w}</div>;})}

          {plan.type==="contract"&&<div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",margin:"8px 0"}}>
              <div style={{flex:"1 1 260px"}}>
                <label>Subcontractor</label>
                <select value={ctrChoice} disabled={!!plan.existing} onChange={function(e){setCtrChoice(e.target.value);var c=(contractors||[]).find(function(x){return x.id===e.target.value;});if(c)setPkgChoice(c.package||"");}} style={{width:"100%",padding:"4px 8px",fontSize:12,fontFamily:"inherit"}}>
                  <option value="__new__">＋ Create “{d.subcontractor}”</option>
                  {(contractors||[]).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(c){return <option key={c.id} value={c.id}>{c.name}</option>;})}
                </select>
                {!plan.existing&&ctrChoice!=="__new__"&&ctrChoice===plan.ctrId&&<div style={{fontSize:10,color:"#2e7d32",marginTop:2}}>Matched from the name in the document — change it if wrong.</div>}
              </div>
              {!plan.existing&&<div style={{flex:"0 1 200px"}}>
                <label>Package</label>
                <select value={pkgChoice} onChange={function(e){setPkgChoice(e.target.value);}} style={{width:"100%",padding:"4px 8px",fontSize:12,fontFamily:"inherit"}}>
                  <option value="">— none —</option>
                  {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
                </select>
              </div>}
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr><th style={Object.assign({},hS,{width:28})}></th><th style={Object.assign({},hS,{width:170})}>Field</th><th style={hS}>In the app</th><th style={hS}>From the document</th></tr></thead>
              <tbody>{plan.rows.map(function(r){
                var bg=r.same?"#fafaf8":r.conflict?"#fff8e1":"#fff";
                return <tr key={r.key} style={{background:bg,opacity:r.same?.55:1}}>
                  <td style={cellS}>{r.same?<span style={{fontSize:10,color:"#aaa"}}>=</span>:<input type="checkbox" checked={!!sel[r.key]} onChange={function(){tog(r.key);}} style={{width:14,height:14}}/>}</td>
                  <td style={Object.assign({},cellS,{fontWeight:600})}>{r.label}{r.conflict&&<div style={{fontSize:9,color:"#ef6c00",fontWeight:700}}>REPLACES CURRENT VALUE</div>}</td>
                  <td style={Object.assign({},cellS,{color:"#888",textDecoration:r.conflict&&sel[r.key]?"line-through":"none"})}>{ctFmtVal(r.old,r.fmt)}</td>
                  <td style={Object.assign({},cellS,{fontWeight:r.same?400:600})}>{ctFmtVal(r.val,r.fmt)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}

          {plan.type==="addendum"&&plan.existing&&<div>
            {d.amountDelta!=null&&<div>
              <div style={secS}><label style={{display:"inline-flex",gap:6,alignItems:"center",cursor:"pointer"}}><input type="checkbox" checked={!!sel.amount} onChange={function(){tog("amount");}} style={{width:14,height:14}}/>Amount</label></div>
              <table style={{width:"100%",borderCollapse:"collapse",opacity:sel.amount?1:.45}}>
                <thead><tr><th style={hS}></th><th style={Object.assign({},hS,{textAlign:"right"})}>Amount</th><th style={Object.assign({},hS,{textAlign:"right"})}>Cumulative</th></tr></thead>
                <tbody>
                  {(function(){
                    var ct=plan.existing.ct;var cum=Number(ct.amount||0);
                    var rows=[<tr key="i"><td style={cellS}>Initial contract</td><td style={Object.assign({},cellS,{textAlign:"right"})}>{cum.toLocaleString()}</td><td style={Object.assign({},cellS,{textAlign:"right"})}>{cum.toLocaleString()}</td></tr>];
                    (ct.addendums||[]).forEach(function(a){cum+=Number(a.amount||0);rows.push(<tr key={a.id}><td style={cellS}>Addendum {a.number||"?"}</td><td style={Object.assign({},cellS,{textAlign:"right"})}>{Number(a.amount||0).toLocaleString()}</td><td style={Object.assign({},cellS,{textAlign:"right"})}>{cum.toLocaleString()}</td></tr>);});
                    rows.push(<tr key="n" style={{background:"#f3e5f5"}}><td style={Object.assign({},cellS,{fontWeight:700})}>Addendum {d.no} (new)</td><td style={Object.assign({},cellS,{textAlign:"right",fontWeight:700})}>{(d.amountDelta>0?"+":"")+d.amountDelta.toLocaleString()}</td><td style={Object.assign({},cellS,{textAlign:"right",fontWeight:700})}>{(cum+d.amountDelta).toLocaleString()}</td></tr>);
                    return rows;
                  })()}
                </tbody>
              </table>
              {d.statedNewTotal!=null&&<div style={{fontSize:11,color:"#888",marginTop:4}}>Total stated in the addendum: {d.statedNewTotal.toLocaleString()}</div>}
            </div>}

            {(plan.changes||[]).length>0&&<div>
              <div style={secS}><label style={{display:"inline-flex",gap:6,alignItems:"center",cursor:"pointer"}}><input type="checkbox" checked={!!sel.dates} onChange={function(){tog("dates");}} style={{width:14,height:14}}/>Dates</label></div>
              <table style={{width:"100%",borderCollapse:"collapse",opacity:sel.dates?1:.45}}>
                <thead><tr><th style={hS}>Date</th><th style={hS}>In force now</th><th style={hS}>New</th><th style={Object.assign({},hS,{textAlign:"right"})}>Shift</th></tr></thead>
                <tbody>{plan.changes.map(function(x,i){
                  var shift=x.current?ctDays(x.current,x.change.to):null;
                  return <tr key={i} style={{background:x.warn?"#fff8e1":"#fff"}}>
                    <td style={Object.assign({},cellS,{fontWeight:600})}>{x.label}</td>
                    <td style={Object.assign({},cellS,{color:"#888"})}>{x.current?fmtDate(x.current):"—"}</td>
                    <td style={Object.assign({},cellS,{fontWeight:700})}>{fmtDate(x.change.to)}</td>
                    <td style={Object.assign({},cellS,{textAlign:"right",color:shift>0?"#c62828":"#2e7d32",fontWeight:700})}>{shift==null?"":(shift>0?"+":"")+shift+" d"}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}

            {d.scopeChanges&&<div>
              <div style={secS}><label style={{display:"inline-flex",gap:6,alignItems:"center",cursor:"pointer"}}><input type="checkbox" checked={!!sel.scope} onChange={function(){tog("scope");}} style={{width:14,height:14}}/>Scope of works</label></div>
              <div style={{opacity:sel.scope?1:.45,fontSize:12}}>
                {d.scopeChanges.summary&&<div style={{marginBottom:4}}>{d.scopeChanges.summary}</div>}
                {(d.scopeChanges.added||[]).map(function(x,i){return <div key={"a"+i} style={{color:"#2e7d32"}}>＋ {x}</div>;})}
                {(d.scopeChanges.removed||[]).map(function(x,i){return <div key={"r"+i} style={{color:"#c62828"}}>－ {x}</div>;})}
              </div>
            </div>}
          </div>}
        </div>}
      </div>
      <div className="modal-footer">
        {!plan
          ?<button className="btn btn-gold" onClick={analyse} disabled={!text.trim()}>Analyse →</button>
          :<React.Fragment>
            <button className="btn" onClick={function(){setPlan(null);}}>← Back</button>
            <button className="btn btn-gold" onClick={apply} disabled={plan.blocking.length>0||nChanges===0}>Apply {nChanges} change{nChanges!==1?"s":""}</button>
          </React.Fragment>}
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  </div>;
}

// Contract as signed + everything addendums changed. Read-only, derived on every render.
function ContractTermsCard({ct}){
  const [open,setOpen]=useState(true);
  var eff=contractEffective(ct);
  var terms=ct.terms||{};
  var hasTerms=CT_TERM_KEYS.some(function(t){return terms[t[0]]!=null&&terms[t[0]]!=="";});
  var ads=ct.addendums||[];
  var hasAny=hasTerms||(ct.milestones||[]).length||ct.scope||eff.changedBy.startDate||eff.changedBy.endDate||ads.length||ct.contractDate||ct.signedDate;
  if(!hasAny)return null;
  var lblS={fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:".05em",marginBottom:4};
  var tdS={padding:"4px 8px",borderBottom:"1px solid #f5f4f0",fontSize:12};
  function dateLine(label,orig,cur,by){
    return <div style={{display:"flex",gap:8,alignItems:"baseline",fontSize:12,marginBottom:3}}>
      <span style={{width:90,color:"#888",flexShrink:0}}>{label}</span>
      <strong>{cur?fmtDate(cur):"—"}</strong>
      {by&&orig&&orig!==cur&&<span style={{color:"#aaa",textDecoration:"line-through"}}>{fmtDate(orig)}</span>}
      {by&&<span className="badge" style={{background:"#f3e5f5",color:"#7b1fa2",fontSize:9}}>{by}</span>}
    </div>;
  }
  var cum=Number(ct.amount||0);
  return <div className="card" style={{marginBottom:10}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){setOpen(!open);}}>
      <div style={{fontWeight:700,fontSize:13}}>Contract terms &amp; scope
        {eff.extensionDays!==0&&<span className="badge" style={{marginLeft:8,background:eff.extensionDays>0?"#fce4ec":"#e8f5e9",color:eff.extensionDays>0?"#c62828":"#2e7d32",fontSize:10}}>{eff.extensionDays>0?"+":""}{eff.extensionDays} d on completion</span>}
      </div>
      <span style={{fontSize:16,color:"#aaa"}}>{open?"▾":"▸"}</span>
    </div>
    {open&&<div style={{marginTop:10,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
      <div>
        <div style={lblS}>Amount</div>
        <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>
          <tr><td style={tdS}>Initial contract</td><td style={Object.assign({},tdS,{textAlign:"right"})}>{cum.toLocaleString()}</td><td style={Object.assign({},tdS,{textAlign:"right",color:"#888"})}>{cum.toLocaleString()}</td></tr>
          {ads.map(function(a){cum+=Number(a.amount||0);var v=Number(a.amount||0);return <tr key={a.id}>
            <td style={tdS}>Addendum {a.number||"?"}{a.date?<span style={{color:"#aaa"}}> · {fmtDate(a.date)}</span>:null}</td>
            <td style={Object.assign({},tdS,{textAlign:"right",color:v<0?"#c62828":"#1a1a1a"})}>{(v>0?"+":"")+v.toLocaleString()}</td>
            <td style={Object.assign({},tdS,{textAlign:"right",fontWeight:600})}>{cum.toLocaleString()}</td></tr>;})}
        </tbody></table>
        <div style={{fontSize:10,color:"#aaa",marginTop:2,textAlign:"right"}}>{ct.currency||"EUR"} excl. tax · last column is cumulative</div>
      </div>
      <div>
        <div style={lblS}>Dates in force</div>
        {ct.contractDate&&dateLine("Contract",null,ct.contractDate,null)}
        {ct.signedDate&&dateLine("Signed",null,ct.signedDate,null)}
        {dateLine("Start",ct.startDate,eff.startDate,eff.changedBy.startDate)}
        {dateLine("Completion",ct.endDate,eff.endDate,eff.changedBy.endDate)}
        {ct.completionLabel&&<div style={{fontSize:11,color:"#888",margin:"-1px 0 6px 98px"}}>{ct.completionLabel}</div>}
        {eff.milestones.length>0&&<div style={{marginTop:8}}>
          <div style={lblS}>Key milestones</div>
          {eff.milestones.map(function(m,i){return <div key={i} style={{fontSize:12,marginBottom:3}}>
            <strong>{m.date?fmtDate(m.date):"—"}</strong>
            {m.changedBy&&m.original&&<span style={{color:"#aaa",textDecoration:"line-through",marginLeft:6}}>{fmtDate(m.original)}</span>}
            {m.changedBy&&<span className="badge" style={{background:"#f3e5f5",color:"#7b1fa2",fontSize:9,marginLeft:6}}>{m.changedBy}</span>}
            <span style={{color:"#555",marginLeft:6}}>{m.label}</span>
          </div>;})}
        </div>}
      </div>
      {(hasTerms||ct.reps)&&<div>
        <div style={lblS}>Terms</div>
        {CT_TERM_KEYS.filter(function(t){return terms[t[0]]!=null&&terms[t[0]]!=="";}).map(function(t){return <div key={t[0]} style={{fontSize:12,marginBottom:4}}>
          <span style={{color:"#888"}}>{t[1]}: </span>{String(terms[t[0]])}
        </div>;})}
        {ct.reps&&(ct.reps.contractor||[]).length>0&&<div style={{fontSize:12,marginBottom:4}}><span style={{color:"#888"}}>Contractor's reps: </span>{ct.reps.contractor.join(", ")}</div>}
        {ct.reps&&(ct.reps.subcontractor||[]).length>0&&<div style={{fontSize:12,marginBottom:4}}><span style={{color:"#888"}}>Subcontractor's reps: </span>{ct.reps.subcontractor.join(", ")}</div>}
      </div>}
      {(ct.scope||eff.scopeAdded.length>0||eff.scopeRemoved.length>0)&&<div style={{gridColumn:"1 / -1"}}>
        <div style={lblS}>Scope of works</div>
        {ct.scope&&ct.scope.summary&&<div style={{fontSize:12,fontWeight:600,marginBottom:4}}>{ct.scope.summary}</div>}
        {ct.scope&&(ct.scope.items||[]).map(function(x,i){return <div key={i} style={{fontSize:12,color:"#3a3f47",paddingLeft:10}}>• {x}</div>;})}
        {eff.scopeAdded.map(function(x,i){return <div key={"a"+i} style={{fontSize:12,color:"#2e7d32",paddingLeft:10}}>＋ {x.text} <span className="badge" style={{background:"#f3e5f5",color:"#7b1fa2",fontSize:9}}>{x.by}</span></div>;})}
        {eff.scopeRemoved.map(function(x,i){return <div key={"r"+i} style={{fontSize:12,color:"#c62828",paddingLeft:10}}>－ {x.text} <span className="badge" style={{background:"#f3e5f5",color:"#7b1fa2",fontSize:9}}>{x.by}</span></div>;})}
      </div>}
      {ct.importedAt&&<div style={{gridColumn:"1 / -1",fontSize:10,color:"#aaa"}}>Imported from the signed document on {fmtDate(ct.importedAt)}{ct.importSources?" · sources: "+Object.keys(ct.importSources).map(function(k){return k+" "+ct.importSources[k];}).join(", "):""}</div>}
    </div>}
  </div>;
}

function ContractsView({contractors,saveContractors,tenders,packages,saveTasks,tasks}){

  const [nav,setNav]=useState(null);
  const [q,setQ]=useState("");
  const [fPkg,setFPkg]=useState("all");
  const [fCtr,setFCtr]=useState("all");
  const [showImport,setShowImport]=useState(false);

  function save(d){
    saveContractors(d);
    if(nav&&nav.ctId){
      var newCtr=d.find(function(c){return c.id===nav.ctrId;});
      var newCt=newCtr?(newCtr.contracts||[]).find(function(c){return c.id===nav.ctId;}):null;
      if(!newCt)setNav({ctrId:nav.ctrId});
    }
  }

  function addContract(ctrId){
    var nc=newContract();
    nc.package=(contractors||[]).find(function(c){return c.id===ctrId;})?((contractors||[]).find(function(c){return c.id===ctrId;}).package||""):"";
    var d=(contractors||[]).map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:[...(c.contracts||[]),nc]});});
    save(d);
    setNav({ctrId:ctrId,ctId:nc.id});
  }

  function updateCtField(ctrId,ctId,field,val){
    if(field==="__delete__"){
      var d2=(contractors||[]).map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).filter(function(ct){return ct.id!==ctId;})});});
      save(d2);return;
    }
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;var u=Object.assign({},ct);u[field]=val;return u;
      })});
    });
    save(d);
  }

  function updateAdItem(ctrId,ctId,field,i,key,val){
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;
        var items=(ct[field]||[]).map(function(item,j){if(j!==i)return item;var u=Object.assign({},item);u[key]=val;return u;});
        var u2=Object.assign({},ct);u2[field]=items;return u2;
      })});
    });
    save(d);
  }

  function delAdItem(ctrId,ctId,field,i){
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;var u=Object.assign({},ct);u[field]=(ct[field]||[]).filter(function(_,j){return j!==i;});return u;
      })});
    });
    save(d);
  }

  function addAdItem(ctrId,ctId,field,newItem){
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;var u=Object.assign({},ct);u[field]=[...(ct[field]||[]),newItem];return u;
      })});
    });
    save(d);
  }

  var importUI=showImport?<ContractImportModal contractors={contractors||[]} packages={packages||[]} onClose={function(){setShowImport(false);}}
    onApply={function(res){saveContractors(res.contractors);setShowImport(false);if(res.target.ctId)setNav({ctrId:res.target.ctrId,ctId:res.target.ctId});}}/>:null;

  if(nav&&nav.ctId){
    var ctr=(contractors||[]).find(function(c){return c.id===nav.ctrId;})||{contracts:[]};
    var ct=(ctr.contracts||[]).find(function(c){return c.id===nav.ctId;})||{addendums:[],certifications:[]};
    var fin=contractFinancials(ct);
    var linkedTender=ct.tenderRef?(tenders||[]).find(function(t){return t.id===ct.tenderRef;}):null;
    var allCtrContracts=(contractors||[]).flatMap(function(c){return (c.contracts||[]).map(function(ct2){return {ct:ct2,ctr:c};});});

    return <div className="md-wrap" style={{display:"flex",gap:14,alignItems:"flex-start"}}>

      <div className="md-side" style={{width:200,flexShrink:0,background:"#fff",borderRadius:12,border:"1.5px solid #e8e6df",overflow:"hidden",position:"sticky",top:0,alignSelf:"flex-start"}}>
        <div style={{padding:"8px 10px",borderBottom:"1.5px solid #e8e6df"}}>
          <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",marginBottom:4}}>Contracts</div>
          <select value={fPkg} onChange={function(e){setFPkg(e.target.value);}} style={{width:"100%",padding:"3px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",background:"#fafaf8"}}>
            <option value="all">All packages</option>
            {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
          </select>
        </div>
        <div style={{maxHeight:"75vh",overflowY:"auto"}}>
          {(contractors||[]).filter(function(c){return (c.contracts||[]).length>0&&(fPkg==="all"||(c.contracts||[]).some(function(ct){return ct.package===fPkg;}));}).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(c){
            var hasSel=c.id===nav.ctrId;
            return <div key={c.id}>
              <div style={{padding:"6px 10px",fontSize:10,fontWeight:800,color:"#888",background:"#fafaf8",textTransform:"uppercase",letterSpacing:".3px"}}>{c.name}</div>
              {(c.contracts||[]).map(function(ct2){
                var isActive=ct2.id===nav.ctId;
                var f2=contractFinancials(ct2);
                return <div key={ct2.id} onClick={function(){setNav({ctrId:c.id,ctId:ct2.id});}} style={{padding:"6px 10px",cursor:"pointer",background:isActive?"#f0ede6":"transparent",borderLeft:"3px solid "+(isActive?"#c9a84c":"transparent")}}>
                  <div style={{fontSize:11,fontWeight:isActive?700:400,color:isActive?"#1c1c1e":"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ct2.number||"(no #)"} {ct2.sapNumber&&<span style={{color:"#1a73e8",fontSize:9}}>SAP</span>}</div>
                  <div style={{fontSize:9,color:"#aaa"}}>{f2.pct}% certified</div>
                </div>;
              })}
            </div>;
          })}
        </div>
      </div>

      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
          <button className="btn btn-sm" onClick={function(){setShowImport(true);}} title="Paste the data Claude extracted from a signed contract or addendum">📥 Import contract / addendum</button>
        </div>
        <CollapseContractDetail ctr={ctr} ct={ct} fin={fin} linkedTender={linkedTender}
          updateCtField={updateCtField} updateAdItem={updateAdItem} delAdItem={delAdItem} addAdItem={addAdItem}
          tenders={tenders} nav={nav} setNav={setNav} saveT={saveTasks} tasks={tasks} people={window._ppPeople||[]} tags={window._ppTags||[]}/>
      </div>
      {importUI}
    </div>;
  }

  if(nav&&nav.ctrId&&!nav.ctId){
    var ctr2=(contractors||[]).find(function(c){return c.id===nav.ctrId;})||{contracts:[]};
    var totVal2=(ctr2.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).total;},0);
    var totCert2=(ctr2.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).certified;},0);
    var linkedTenders2=(ctr2.tenderRefs||[ctr2.tenderRef].filter(Boolean)).map(function(id){return (tenders||[]).find(function(t){return t.id===id;});}).filter(Boolean);
    return <div>
      {importUI}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
        <button className="btn btn-sm" onClick={function(){setNav(null);}}>← Back</button>
        <div style={{flex:1}}>
          <div className="page-title">{ctr2.name}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4,alignItems:"center"}}>
            {ctr2.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>📦 {ctr2.package}</span>}
            {ctr2.owner&&<OwnerChip owner={ctr2.owner}/>}
            {linkedTenders2.map(function(lt){return lt?<span key={lt.id} className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa"}}>📑 {lt.title}</span>:null;})}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:13,fontWeight:700}}>{totVal2.toLocaleString()} EUR</div>
          <div style={{fontSize:11,color:"#2e7d32"}}>Certified: {totCert2.toLocaleString()}</div>
        </div>
      </div>

      {(ctr2.contracts||[]).length===0
        ?<div className="empty"><div className="empty-ico">📋</div><div className="empty-txt">No contracts for this subcontractor.</div></div>
        :(ctr2.contracts||[]).map(function(ct){
          var fin=contractFinancials(ct);
          var lt2=ct.tenderRef?(tenders||[]).find(function(t){return t.id===ct.tenderRef;}):null;
          return <div key={ct.id} className="ctr-card" onClick={function(){setNav({ctrId:ctr2.id,ctId:ct.id});}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{ct.number||"(no number)"} {ct.sapNumber&&<span style={{fontSize:12,color:"#1a73e8",fontWeight:600}}>· SAP {ct.sapNumber}</span>}</div>
                <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
                  {ct.package&&<span className="badge" style={{background:"#f0ede6",color:"#555",fontSize:10}}>📦 {ct.package}</span>}
                  {lt2&&<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {lt2.title}</span>}
                  {ct.description&&<span style={{fontSize:11,color:"#888"}}>{ct.description}</span>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:15,fontWeight:800}}>{fin.total.toLocaleString()} <span style={{fontSize:11}}>{ct.currency||"EUR"}</span></div>
                <div style={{fontSize:11,color:"#2e7d32"}}>Certified: {fin.certified.toLocaleString()} ({fin.pct}%)</div>
                <div style={{fontSize:11,color:fin.remaining<0?"#c62828":"#888"}}>Left: {fin.remaining.toLocaleString()}</div>
              </div>
            </div>
            <div className="pbar" style={{marginTop:8}}><div className="pfill" style={{width:fin.pct+"%",background:fin.pct>=90?"#c62828":fin.pct>=70?"#f57f17":"#2e7d32"}}/></div>
            <div style={{fontSize:11,color:"#aaa",marginTop:4}}>
              {(ct.addendums||[]).length} addendum{(ct.addendums||[]).length!==1?"s":""} · {(ct.certifications||[]).length} certification{(ct.certifications||[]).length!==1?"s":""}
              {fin.forecast&&<span style={{marginLeft:8,color:fin.forecast>(ct.endDate||"9999")?"#c62828":"#2e7d32",fontWeight:600}}>Forecast: {fmtMonthYear(fin.forecast)}</span>}
            </div>
          </div>;
        })}
    </div>;
  }

  var allContracts=[];
  (contractors||[]).forEach(function(ctr){(ctr.contracts||[]).forEach(function(ct){allContracts.push({ct:ct,ctr:ctr});});});
  var allPkgs=[...new Set(allContracts.map(function(x){return x.ct.package;}).filter(Boolean))].sort();
  var allCtrs=[...new Set((contractors||[]).map(function(c){return c.name;}).filter(Boolean))].sort();
  var filtered=allContracts.filter(function(x){
    if(fPkg!=="all"&&x.ct.package!==fPkg)return false;
    if(fCtr!=="all"&&x.ctr.name!==fCtr)return false;
    if(q){var lq=q.toLowerCase();if(!(x.ct.number||"").toLowerCase().includes(lq)&&!(x.ct.sapNumber||"").toLowerCase().includes(lq)&&!(x.ctr.name||"").toLowerCase().includes(lq))return false;}
    return true;
  });

  return <div>
    {importUI}
    <div className="page-hdr">
      <div><div className="page-title">Contracts</div>
        <div className="page-sub">{allContracts.length} contracts · {(contractors||[]).length} subcontractors</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <button className="btn" onClick={function(){setShowImport(true);}} title="Paste the data Claude extracted from a signed contract or addendum">📥 Import</button>
        <select id="new-contract-ctr" style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
          <option value="">Select subcontractor…</option>
          {(contractors||[]).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(c){return <option key={c.id} value={c.id}>{c.name}</option>;})}
        </select>
        <button className="btn btn-gold" onClick={function(){
          var sel=document.getElementById("new-contract-ctr");
          if(!sel||!sel.value){alert("Please select a subcontractor first.");return;}
          addContract(sel.value);
          setNav({ctrId:sel.value});
        }}>＋ New Contract</button>
      </div>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Search contract, SAP..." style={{width:220,padding:"5px 10px",fontSize:12}}/>
      <select value={fCtr} onChange={function(e){setFCtr(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All subcontractors</option>
        {allCtrs.map(function(n){return <option key={n} value={n}>{n}</option>;})}
      </select>
      <select value={fPkg} onChange={function(e){
        var newPkg=e.target.value;
        setFPkg(newPkg);
        // if the selected subcontractor has no contract in the new package, clear it
        if(fCtr!=="all"&&newPkg!=="all"){var ctr=(contractors||[]).find(function(c){return c.name===fCtr;});if(ctr&&!(ctr.contracts||[]).some(function(ct){return ct.package===newPkg;}))setFCtr("all");}
      }} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All packages</option>
        {allPkgs.map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      {(q||fCtr!=="all"||fPkg!=="all")&&<button className="btn btn-sm" onClick={function(){setQ("");setFCtr("all");setFPkg("all");}}>✕ Reset</button>}
    </div>

    {(contractors||[]).filter(function(ctr){
      if(fCtr!=="all"&&ctr.name!==fCtr)return false;
      if((ctr.contracts||[]).length===0)return false;
      if(q){return (ctr.contracts||[]).some(function(ct){var lq=q.toLowerCase();return (ct.number||"").toLowerCase().includes(lq)||(ct.sapNumber||"").toLowerCase().includes(lq)||(ctr.name||"").toLowerCase().includes(lq);});}
      return true;
    }).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(ctr){
      var ctrs=ctr.contracts||[];
      var totV=ctrs.reduce(function(s,ct){return s+contractFinancials(ct).total;},0);
      var totC=ctrs.reduce(function(s,ct){return s+contractFinancials(ct).certified;},0);
      return <div key={ctr.id} style={{marginBottom:16}}>
        <div className="ctr-card" style={{borderBottom:"2px solid #e8e6df",borderRadius:"12px 12px 0 0",cursor:"pointer",background:"#f8f7f4"}} onClick={function(){setNav({ctrId:ctr.id});}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:15}}>{ctr.name}</div>
              <div style={{fontSize:12,color:"#888"}}>{ctr.package&&"📦 "+ctr.package} · {ctrs.length} contract{ctrs.length!==1?"s":""}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontWeight:700,fontSize:13}}>{totV.toLocaleString()} EUR</div>
              <div style={{fontSize:11,color:"#2e7d32"}}>Certified: {totC.toLocaleString()}</div>
            </div>
            <span style={{fontSize:16,color:"#aaa"}}>›</span>
          </div>
        </div>
        <div style={{borderRadius:"0 0 12px 12px",border:"1.5px solid #e8e6df",borderTop:"none",overflow:"hidden"}}>
          {ctrs.filter(function(ct){if(!q)return true;var lq=q.toLowerCase();return (ct.number||"").toLowerCase().includes(lq)||(ct.sapNumber||"").toLowerCase().includes(lq);}).map(function(ct){
            var fin=contractFinancials(ct);
            var lt=ct.tenderRef?(tenders||[]).find(function(t){return t.id===ct.tenderRef;}):null;
            return <div key={ct.id} style={{padding:"10px 14px",borderBottom:"1px solid #f5f4f0",cursor:"pointer",background:"#fff",display:"flex",alignItems:"center",gap:10}} onClick={function(){setNav({ctrId:ctr.id,ctId:ct.id});}}
              onMouseEnter={function(e){e.currentTarget.style.background="#fafaf8";}} onMouseLeave={function(e){e.currentTarget.style.background="#fff";}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{ct.number||"(no number)"} {ct.sapNumber&&<span style={{color:"#1a73e8",fontSize:11}}>SAP {ct.sapNumber}</span>}</div>
                <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap"}}>
                  {lt&&<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {lt.title}</span>}
                  {ct.package&&<span className="badge" style={{background:"#f0ede6",color:"#555",fontSize:10}}>📦 {ct.package}</span>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontWeight:600,fontSize:12}}>{fin.total.toLocaleString()} {ct.currency||"EUR"}</div>
                <div style={{fontSize:10,color:"#2e7d32"}}>{fin.pct}% certified</div>
                {(function(){
                  if(ct.closed)return <div style={{fontSize:9,color:"#2e7d32",fontWeight:700}}>✅ Closed{ct.cacSigned?" · CAC":""}</div>;
                  var certs=ct.certifications||[];
                  if(certs.length===0)return null;
                  var lastDate=(certs.slice().sort(function(a,b){return (b.date||"").localeCompare(a.date||"");})[0]||{}).date||"";
                  if(!lastDate)return null;
                  var d=new Date(lastDate);var now=new Date();
                  var months=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());
                  var late=months>=2;
                  return <div style={{fontSize:9,fontWeight:late?700:400,color:late?"#c62828":"#aaa"}}>{late?"⚠️ ":""}Last cert: {fmtMonthYear(lastDate)}</div>;
                })()}
              </div>
              <div style={{width:50}}>
                <div style={{height:4,background:"#f0ede6",borderRadius:2,overflow:"hidden"}}>
                  <div style={{width:fin.pct+"%",height:"100%",background:fin.pct>=90?"#c62828":fin.pct>=70?"#f57f17":"#2e7d32"}}/>
                </div>
              </div>
              <span style={{fontSize:14,color:"#ccc"}}>›</span>
            </div>;
          })}
        </div>
      </div>;
    })}
    {allContracts.length===0&&<div className="empty"><div className="empty-ico">📋</div><div className="empty-txt">No contracts yet. Add contracts from the Subcontractors tab.</div></div>}
  </div>;
}
function PackagesView({tasks,tenders,contractors,packages,people,pkgOwners,pkgSubcontractors,saveTasks,tags,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [openPkg,setOpenPkg]=useState(mem.openPkg!==undefined?mem.openPkg:null);
  const [fOnlyIssues,setFOnlyIssues]=useState(mem.fOnlyIssues||false);
  useEffect(function(){if(setMemory)setMemory({openPkg:openPkg,fOnlyIssues:fOnlyIssues});},[openPkg,fOnlyIssues]);
  var todayStr=today();

  // Build per-package aggregation
  var rows=(packages||[]).map(function(pkg){
    var pkgTenders=(tenders||[]).filter(function(t){return t.package===pkg;});
    var owner=(pkgOwners||{})[pkg]||"";
    var subcontractor=(pkgSubcontractors||{})[pkg]||"";

    // MAR-only stats: validated / total (total = all materials in package's tenders)
    var marTotal=0,marApproved=0;
    pkgTenders.forEach(function(t){
      (t.materials||[]).forEach(function(mat){
        marTotal++;
        var app=mat.marApprovalStatus||"";
        var sub=mat.marStatus||"";
        var st=app==="approved"?"approved":(app?"pending approval":sub);
        if(st==="approved")marApproved++;
      });
    });

    // ITP / WMS submitted vs total tenders in package
    var itpTotal=pkgTenders.length;
    var itpSubmitted=pkgTenders.filter(function(t){return!!((t.stepDates||{}).itp||{}).done;}).length;
    var wmsTotal=pkgTenders.length;
    var wmsSubmitted=pkgTenders.filter(function(t){return!!((t.stepDates||{}).wms||{}).done;}).length;

    // Financials aggregated across the package's tenders
    var budgetTotal=pkgTenders.reduce(function(s,t){return s+(Number(t.budget)||0);},0);
    var budgetTreated=pkgTenders.reduce(function(s,t){return s+(Number(t.accAmountTreated)||0);},0);
    var costTreated=0;
    pkgTenders.forEach(function(t){
      (contractors||[]).forEach(function(ctr){
        (ctr.contracts||[]).forEach(function(ct){
          if(ct.tenderRef===t.id)costTreated+=contractFinancials(ct).certified;
        });
      });
    });
    var varianceTreated=budgetTreated-costTreated;

    // Tender steps progress (across all tenders of the pkg — worst case shown)
    function stepAgg(key){
      var vals=pkgTenders.map(function(t){return(t.steps||{})[key]||"";}).filter(Boolean);
      if(vals.length===0)return{state:"none",label:"—"};
      var allApproved=vals.every(function(v){var lv=v.toLowerCase();return lv==="approved a"||lv==="approved b"||lv==="approved"||lv==="signed"||lv==="n/a";});
      var anyRejected=vals.some(function(v){var lv=v.toLowerCase();return lv.includes("reject")||lv==="not approved";});
      if(anyRejected)return{state:"bad",label:vals.length+""};
      if(allApproved)return{state:"ok",label:vals.length+""};
      return{state:"progress",label:vals.length+""};
    }
    var steps=["bidders","pkg","acc","itp","wms"].map(function(k){return{key:k,agg:stepAgg(k)};});

    // Contract stage (most advanced per tender, summarized)
    var contractStages=pkgTenders.map(function(t){
      var ct=(t.stepDates||{}).contract||{};
      if(ct.signedDone||ct.signedAllDone)return 4;
      if(ct.circulateDone)return 3;
      if(ct.requestDone)return 2;
      var acc=((t.stepDates||{}).acc||{}).approval;
      if(acc)return 1;
      return 0;
    });
    var CONTRACT_LABELS=["—","To request","To circulate","To sign","✅ Signed"];
    var minStage=contractStages.length?Math.min.apply(null,contractStages):0;
    var maxStage=contractStages.length?Math.max.apply(null,contractStages):0;

    // MSS/MAR/SD counts
    var counts={approved:0,pending:0,prep:0,overdue:0,rejected:0};
    pkgTenders.forEach(function(t){
      (t.materials||[]).forEach(function(mat){
        ["mss","mar"].forEach(function(k){
          var app=mat[k+"ApprovalStatus"]||"";
          var sub=mat[k+"Status"]||"";
          var st=app==="approved"?"approved":(app?"pending approval":sub);
          if(!st)return;
          if(st==="approved")counts.approved++;
          else if(st==="rejected")counts.rejected++;
          else if(st==="under preparation")counts.prep++;
          else{counts.pending++;
            var done=mat[k+"Done"]||"";
            if(done){var d=new Date(done);d.setDate(d.getDate()+getDur("clientResponse"));if(toISO(d)<todayStr)counts.overdue++;}
          }
        });
      });
      if(t.hasSD){
        var app=t.sdApprovalStatus||"";var sub=t.sdStatus||"";
        var st=app==="approved"?"approved":(app?"pending approval":sub);
        if(st==="approved")counts.approved++;
        else if(st==="rejected")counts.rejected++;
        else if(st==="under preparation")counts.prep++;
        else if(st){counts.pending++;
          if(t.sdDone){var d2=new Date(t.sdDone);d2.setDate(d2.getDate()+getDur("clientResponse"));if(toISO(d2)<todayStr)counts.overdue++;}
        }
      }
    });

    // Open actions for this package
    var pkgActions=(tasks||[]).filter(function(t){return t.package===pkg&&t.status!=="done"&&!t.isInfo;});
    var overdueActions=pkgActions.filter(function(t){return t.due&&t.due<todayStr;}).length;
    var blockingActions=pkgActions.filter(function(t){return(t.tags||[]).includes("Blocking Point");}).length;

    var nextSteps=pkgTenders.map(function(t){return t.nextStep;}).filter(Boolean);

    var hasIssues=overdueActions>0||blockingActions>0||counts.overdue>0||counts.rejected>0;

    return{pkg:pkg,owner:owner,subcontractor:subcontractor,tenders:pkgTenders,steps:steps,minStage:minStage,maxStage:maxStage,CONTRACT_LABELS:CONTRACT_LABELS,counts:counts,marTotal:marTotal,marApproved:marApproved,itpTotal:itpTotal,itpSubmitted:itpSubmitted,wmsTotal:wmsTotal,wmsSubmitted:wmsSubmitted,budgetTotal:budgetTotal,budgetTreated:budgetTreated,costTreated:costTreated,varianceTreated:varianceTreated,actions:pkgActions,overdueActions:overdueActions,blockingActions:blockingActions,nextSteps:nextSteps,hasIssues:hasIssues};
  }).filter(function(r){return r.tenders.length>0||r.actions.length>0;});

  var shown=fOnlyIssues?rows.filter(function(r){return r.hasIssues;}):rows;

  function stepDot(agg){
    var c=agg.state==="ok"?"#2e7d32":agg.state==="bad"?"#c62828":agg.state==="progress"?"#f57f17":"#ddd";
    return c;
  }

  function updateAction(id,updates){
    saveTasks((tasks||[]).map(function(t){return t.id===id?stampModified(Object.assign({},t,updates)):t;}));
  }

  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">🗂️ Departments</div>
        <div className="page-sub">{shown.length} departments · live status from packages, contracts, quality docs & actions</div>
      </div>
      <button className={"fchip"+(fOnlyIssues?" on":"")} onClick={function(){setFOnlyIssues(!fOnlyIssues);}}>⚠️ Issues only</button>
    </div>

    {shown.length===0&&<div className="empty"><div className="empty-ico">📦</div><div className="empty-txt">No packages with activity.</div></div>}

    {shown.map(function(r){
      var isOpen=openPkg===r.pkg;
      return <div key={r.pkg} className="card" style={{marginBottom:8,padding:0,overflow:"hidden",borderColor:r.blockingActions>0?"#f48fb1":r.hasIssues?"#ffe082":"#e8e6df"}}>

        <div onClick={function(){setOpenPkg(isOpen?null:r.pkg);}} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",flexWrap:"wrap",background:isOpen?"#fafaf8":"#fff"}}>
          <span style={{fontSize:12,color:"#aaa"}}>{isOpen?"▾":"▸"}</span>

          <div style={{minWidth:140,flex:"0 0 auto"}}>
            <div style={{fontWeight:700,fontSize:14}}>{r.pkg}</div>
            <div style={{fontSize:10,color:"#888"}}>{r.owner?r.owner.split(",")[0]:"No owner"} · {r.tenders.length} tender{r.tenders.length!==1?"s":""}</div>
            {r.subcontractor&&<div style={{fontSize:10,color:"#1a73e8",fontWeight:600}}>🤝 {r.subcontractor}</div>}
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>MAR</div>
            <div style={{fontSize:12,fontWeight:700,color:r.marTotal===0?"#ccc":r.marApproved===r.marTotal?"#2e7d32":"#f57f17"}}>
              {r.marTotal===0?"—":r.marApproved+"/"+r.marTotal}
            </div>
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>ITP</div>
            <div style={{fontSize:12,fontWeight:700,color:r.itpTotal===0?"#ccc":r.itpSubmitted===r.itpTotal?"#2e7d32":"#f57f17"}}>
              {r.itpTotal===0?"—":r.itpSubmitted+"/"+r.itpTotal}
            </div>
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>WMS</div>
            <div style={{fontSize:12,fontWeight:700,color:r.wmsTotal===0?"#ccc":r.wmsSubmitted===r.wmsTotal?"#2e7d32":"#f57f17"}}>
              {r.wmsTotal===0?"—":r.wmsSubmitted+"/"+r.wmsTotal}
            </div>
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:0,minWidth:110}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>Budget / Treated</div>
            <div style={{fontSize:11,fontWeight:700}}>{r.budgetTotal>0?r.budgetTotal.toLocaleString():"—"} <span style={{color:"#888",fontWeight:400}}>tot.</span></div>
            <div style={{fontSize:10,color:"#1a73e8"}}>{r.budgetTreated>0?r.budgetTreated.toLocaleString():"—"} bud. tr.</div>
            <div style={{fontSize:10,color:"#2e7d32"}}>{r.costTreated>0?r.costTreated.toLocaleString():"—"} cost tr.</div>
            {r.budgetTreated>0&&<div style={{fontSize:10,fontWeight:700,color:r.varianceTreated<0?"#c62828":"#2e7d32"}}>{r.varianceTreated>0?"+":""}{r.varianceTreated.toLocaleString()} var.</div>}
          </div>

          <div style={{flex:"0 0 auto",display:"flex",gap:5,alignItems:"center"}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase",marginRight:2}}>Quality</div>
            {r.counts.approved>0&&<span className="badge" style={{background:"#e8f5e9",color:"#2e7d32"}}>✓{r.counts.approved}</span>}
            {r.counts.pending>0&&<span className="badge" style={{background:"#fff8e1",color:"#f57f17"}}>⏳{r.counts.pending}</span>}
            {r.counts.prep>0&&<span className="badge" style={{background:"#e3f2fd",color:"#1565c0"}}>🛠{r.counts.prep}</span>}
            {r.counts.rejected>0&&<span className="badge" style={{background:"#fce4ec",color:"#c62828"}}>✗{r.counts.rejected}</span>}
            {r.counts.overdue>0&&<span className="badge" style={{background:"#c62828",color:"#fff"}}>⚠{r.counts.overdue}</span>}
            {r.counts.approved+r.counts.pending+r.counts.prep+r.counts.rejected===0&&<span style={{fontSize:11,color:"#ccc"}}>—</span>}
          </div>

          <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flex:"0 0 auto"}}>
            {r.blockingActions>0&&<span className="badge" style={{background:"#c62828",color:"#fff",fontSize:11}}>🔴 {r.blockingActions} blocking</span>}
            {r.overdueActions>0&&<span className="badge" style={{background:"#fff3e0",color:"#e65100",fontSize:11}}>⚠️ {r.overdueActions} late</span>}
            <span className="badge" style={{background:r.actions.length>0?"#1c1c1e":"#f5f4f0",color:r.actions.length>0?"#fff":"#aaa",fontSize:11}}>{r.actions.length} open action{r.actions.length!==1?"s":""}</span>
          </div>
        </div>

        {isOpen&&<div style={{borderTop:"1.5px solid #f0ede6",padding:"12px 16px",background:"#fafaf8"}}>

          {r.nextSteps.length>0&&<div style={{marginBottom:10,padding:"8px 12px",background:"#f3e5f5",borderRadius:7,border:"1px solid #ce93d8"}}>
            <div style={{fontSize:10,fontWeight:800,color:"#7b1fa2",marginBottom:3,textTransform:"uppercase"}}>🎯 Next steps</div>
            {r.nextSteps.map(function(ns,i){return <div key={i} style={{fontSize:12,color:"#4a148c"}}>{ns}</div>;})}
          </div>}

          <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:4}}>Open actions ({r.actions.length})</div>
          {r.actions.length===0&&<div style={{fontSize:12,color:"#bbb"}}>No open actions for this package. 🎉</div>}
          {r.actions.slice().sort(function(a,b){
            var ab=(a.tags||[]).includes("Blocking Point")?0:1;
            var bb=(b.tags||[]).includes("Blocking Point")?0:1;
            if(ab!==bb)return ab-bb;
            return(a.due||"9999")<(b.due||"9999")?-1:1;
          }).map(function(a){
            var isLate=a.due&&a.due<todayStr;
            var isBlocking=(a.tags||[]).includes("Blocking Point");
            return <div key={a.id} className="ac-item" style={{borderColor:isBlocking?"#f48fb1":isLate?"#ffe082":"#e8e6df",background:isBlocking?"#fff5f7":"#fff"}}>
              <div className={"ac-check"+(a.status==="done"?" done":"")} onClick={function(){updateAction(a.id,{status:a.status==="done"?"pending":"done",completedAt:a.status==="done"?"":todayStr});}}>{a.status==="done"?"✓":""}</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="ac-text">{a.text}</div>
                <div className="ac-meta">
                  {a.owner&&<OwnerChip owner={a.owner}/>}
                  {a.due&&<span style={{fontSize:10,fontWeight:700,color:isLate?"#c62828":"#888"}}>{isLate?"⚠️ ":""}📅 {fmtDate(a.due)}</span>}
                  {(a.tags||[]).map(function(tg){return <TagChip key={tg} tag={tg}/>;})}
                  {a.addedBy&&<span style={{fontSize:9,color:"#bbb"}}>by {a.addedBy==="System"?"🤖 System":a.addedBy.split(",")[0]}</span>}
                </div>
              </div>
              <select value={a.status||"pending"} onChange={function(e){updateAction(a.id,{status:e.target.value,completedAt:e.target.value==="done"?todayStr:""});}} style={{fontSize:10,padding:"2px 4px",width:100,flexShrink:0}}>
                {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
              </select>
            </div>;
          })}

          {r.tenders.length>0&&<div style={{marginTop:12}}>
            <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:4}}>Tenders</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {r.tenders.map(function(t){
                return <button key={t.id} className="btn btn-sm" onClick={function(){if(onNavTender)onNavTender(t.id,"packages");}} style={{fontSize:11}}>📑 {t.title}</button>;
              })}
            </div>
          </div>}
        </div>}
      </div>;
    })}
  </div>;
}

function buildTrackedDocs(tasks,tenders,contractors){
  var docs=[];
  var todayStr=today();

  (tasks||[]).forEach(function(t){
    var isRfi=(t.tags||[]).includes("RFI");
    var isFcr=(t.tags||[]).includes("FCR");
    if(!isRfi&&!isFcr)return;
    var stageKey=isFcr?"fcr":"rfi";
    var stageLbl=isFcr?"FCR":"RFI";
    var tdr=(tenders||[]).find(function(x){return x.id===t.tenderRef;})||null;
    var submitted=t.rfiSubmission||"";
    var due=t.rfiDue||(submitted?(function(){var d=new Date(submitted);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"");
    var overdue=due&&due<todayStr&&t.status!=="done";
    var withClient=!!submitted&&t.status!=="done";
    docs.push({
      id:t.id,stage:stageKey,stageLabel:stageLbl,
      text:t.text,owner:t.owner||"",
      package:t.package||"",
      tenderRef:t.tenderRef||"",tenderTitle:tdr?tdr.title:"",
      submissionDate:submitted,dueDate:due,
      status:t.status,overdue:overdue,withClient:withClient,
      daysOverdue:due?workingDaysDiff(due,todayStr):0,
      _taskId:t.id,_type:"task"
    });
  });

  (contractors||[]).forEach(function(ctr){
    (ctr.contracts||[]).forEach(function(ct){
      [{key:"contract_acc",label:"Contract ACC",dk:"acc"},{key:"contract_aconex",label:"Contract ACONEX",dk:"aconex"}].forEach(function(docType){
        var status=ct[docType.dk+"Status"]||"";
        var subDate=ct[docType.dk+"Date"]||"";
        if(ctNoClient(ct,docType.dk))return;
        if(!subDate&&!status)return;
        var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
        var overdue=status!=="approved"&&!!due14&&due14<todayStr;
        var withClient=!!subDate&&status!=="approved";
        docs.push({
          id:ct.id+"_"+docType.dk,stage:docType.key,stageLabel:docType.label,
          text:ctr.name+(ct.number?" — "+ct.number:"")+" ("+docType.label+")",
          owner:ct.owner||ctr.owner||"",package:ct.package||ctr.package||"",
          tenderRef:ct.tenderRef||"",tenderTitle:"",submissionDate:subDate,
          dueDate:due14,targetDate:subDate,overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
          stepStatus:status,_type:"contract"
        });
      });
      (ct.addendums||[]).forEach(function(ad){
        [{key:"contract_acc",label:"Add. ACC",dk:"acc"},{key:"contract_aconex",label:"Add. ACONEX",dk:"aconex"}].forEach(function(docType){
          var status=ad[docType.dk+"Status"]||"";
          var subDate=ad[docType.dk+"Date"]||"";
          if(ctNoClient(ad,docType.dk))return;
          if(!subDate&&!status)return;
          var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
          var overdue=status!=="approved"&&!!due14&&due14<todayStr;
          var withClient=!!subDate&&status!=="approved";
          docs.push({
            id:ct.id+"_add_"+ad.id+"_"+docType.dk,stage:docType.key,stageLabel:"Addum. "+docType.label.split(" ")[1],
            text:ctr.name+(ct.number?" C"+ct.number:"")+(ad.number?" Add."+ad.number:"")+" ("+docType.label.split(" ")[1]+")",
            owner:ct.owner||ctr.owner||"",package:ct.package||ctr.package||"",
            tenderRef:ct.tenderRef||"",tenderTitle:"",submissionDate:subDate,
            dueDate:due14,targetDate:subDate,overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
            stepStatus:status,_type:"contract"
          });
        });
      });
    });
  });

  (tenders||[]).forEach(function(td){
    if(!td.hasSD)return;
    var subDone=td.sdDone||"";
    var appDone=td.sdApprovalDone||"";
    var appStatus=td.sdApprovalStatus||"";
    if(!subDone)return;
    var due14=(function(){var d=new Date(subDone);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}());
    var overdue=appStatus!=="approved"&&!appDone&&due14<todayStr;
    var withClient=appStatus!=="approved"&&!appDone;
    docs.push({
      id:td.id+"_sd",stage:"sd_approval",stageLabel:"SD Approval",
      text:td.title+" — SD Approval",
      owner:td.ownerTender||"",package:td.package||"",
      tenderRef:td.id,tenderTitle:td.title,
      submissionDate:subDone,dueDate:due14,targetDate:subDone,
      overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
      stepStatus:appStatus||"pending approval",_type:"tender"
    });
  });

  var TENDER_DOC_STEPS=["acc","mar","itp","wms"];
  var STEP_LABELS={acc:"ACC/ACONEX",mar:"MAR",itp:"ITP",wms:"WMS"};
  (tenders||[]).forEach(function(td){
    TENDER_DOC_STEPS.forEach(function(step){
      var stepStatus=(td.steps||{})[step]||"";
      var targetDate=((td.stepDates||{})[step]||{}).target||"";
      var doneDate=((td.stepDates||{})[step]||{}).done||"";
      var approvalDate=((td.stepDates||{})[step]||{}).approval||"";

      var isApproved=stepStatus.toLowerCase().includes("approved");
      var isDone=!!doneDate||isApproved;
      var isApprovalDone=!!approvalDate||isApproved;

      var dueDateFromDone=doneDate?(function(){var d=new Date(doneDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
      var dueDateFromTarget=targetDate?(function(){var d=new Date(targetDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";

      var effectiveDue=doneDate?dueDateFromDone:dueDateFromTarget;
      var effectiveSubmission=doneDate||"";
      if(!effectiveDue)return;
      var overdue=(doneDate?!isApprovalDone:!isDone)&&effectiveDue<todayStr;
      var withClient=!!doneDate&&!isApprovalDone&&!isApproved;
      var daysOverdue=overdue?workingDaysDiff(effectiveDue,todayStr):0;
      docs.push({
        id:td.id+"_"+step,stage:step,stageLabel:STEP_LABELS[step],
        text:td.title+" — "+STEP_LABELS[step],
        owner:td.ownerTender||"",
        package:td.package||"",
        tenderRef:td.id,tenderTitle:td.title,
        submissionDate:effectiveSubmission||doneDate||"",dueDate:effectiveDue,targetDate:targetDate,
        status:isDone?"done":"pending",overdue:overdue,withClient:withClient,
        daysOverdue:daysOverdue,
        stepStatus:stepStatus,
        _tenderId:td.id,_step:step,_type:"tender"
      });
    });
  });

  (tenders||[]).forEach(function(td){
    (td.materials||[]).forEach(function(mat){
      [{type:"mss",label:"MSS"},{type:"mar",label:"MAR"}].forEach(function(m){
        var status=mat[m.type+"Status"]||"";
        var approvalStatus=mat[m.type+"ApprovalStatus"]||"";
        var done=mat[m.type+"Done"]||"";
        var target=mat[m.type+"Target"]||"";
        var isClosed=approvalStatus==="approved"||approvalStatus==="rejected"||status==="approved"||status==="rejected";
        if(isClosed)return;
        var isSubmittedPhase=(status==="submitted"||status==="pending approval"||approvalStatus==="pending approval");
        var dueDate,overdue,withClient,submissionDate,stepStatus,stageLabel;
        if(isSubmittedPhase&&done){
          // Submitted, waiting on the client's response window.
          dueDate=(function(){var d=new Date(done);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}());
          overdue=dueDate<todayStr;
          withClient=true;submissionDate=done;stepStatus=approvalStatus||"Pending approval";stageLabel=m.label+" Approval";
        }else if(!done&&target&&target<todayStr){
          // Never submitted, and the target itself has already passed — invisible before,
          // since overdue only ever fired once a submission was on record.
          dueDate=target;overdue=true;withClient=false;submissionDate="";stepStatus=status||"Not submitted";stageLabel=m.label+" Submission";
        }else{
          return;
        }
        docs.push({
          id:td.id+"_"+mat.id+"_"+m.type,
          stage:m.type,stageLabel:stageLabel,
          text:td.title+" — "+m.label+": "+(mat.name||"—"),
          owner:td.ownerTender||"",package:td.package||"",
          tenderRef:td.id,tenderTitle:td.title,
          submissionDate:submissionDate,dueDate:dueDate,targetDate:target,
          overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(dueDate,todayStr):0,
          stepStatus:stepStatus,_type:"material"
        });
      });
    });
  });

  return docs;
}

// ---------------------------------------------------------------------------
// Client email — everything waiting on the client, as a ready-to-send email.
// Read only, no Firebase write. The overdue logic comes from buildTrackedDocs(), so the
// email and the Follow-up table always agree. SD transmissions are added here because
// buildTrackedDocs only knows the older single-SD fields.
// ---------------------------------------------------------------------------
const CLIENT_EMAIL_TYPES=[
  {key:"ACC",label:"ACC/Aconex"},
  {key:"MAR",label:"MAR"},
  {key:"MSS",label:"MSS"},
  {key:"SD",label:"SD"},
  {key:"WMS",label:"WMS"},
  {key:"ITP",label:"ITP"},
  {key:"RFI",label:"RFI"},
  {key:"FCR",label:"FCR"},
  {key:"CONTRACT",label:"Contract docs"}
];
function clientEmailTypeOf(stage){
  return ({acc:"ACC",mar:"MAR",mss:"MSS",sd_approval:"SD",wms:"WMS",itp:"ITP",
    rfi:"RFI",fcr:"FCR",contract_acc:"CONTRACT",contract_aconex:"CONTRACT"})[stage]||"";
}
// JJ/MM/AA read straight from the ISO string — no Date object, so no timezone shift.
function clientEmailDate(iso){
  var s=String(iso||"");
  if(!/^\d{4}-\d{2}-\d{2}/.test(s))return "";
  return s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(2,4);
}
function collectClientEmailDocs(tasks,tenders,contractors,filters){
  var f=filters||{};
  var todayStr=today();
  var tdById={};
  var matInfo={};
  var withTransmissions={};
  (tenders||[]).forEach(function(td){
    tdById[td.id]=td;
    if(td.hasSD&&(td.sdTransmissions||[]).length>0)withTransmissions[td.id]=true;
    (td.materials||[]).forEach(function(mat){
      ["mss","mar"].forEach(function(k){
        // "Reference" column of the materials table first, older "N°" field as fallback
        matInfo[td.id+"_"+mat.id+"_"+k]={ref:String(mat[k+"Ref"]||mat[k+"Number"]||"").trim(),name:mat.name||""};
      });
    });
  });

  var out=[];
  buildTrackedDocs(tasks,tenders,contractors).forEach(function(d){
    if(!d.withClient)return;
    var type=clientEmailTypeOf(d.stage);
    if(!type)return;
    var td=d.tenderRef?tdById[d.tenderRef]:null;
    if(td&&td.cancelled)return;
    // a tender with transmissions is listed transmission by transmission below
    if(type==="SD"&&td&&withTransmissions[td.id])return;
    var ref="";
    var title=d.tenderTitle||d.text||"";
    var label=type;
    if(d._type==="material"){
      var mi=matInfo[d.id]||{};
      ref=mi.ref||"";
      title=(d.tenderTitle||"")+(mi.name?" – "+mi.name:"");
    }else if(d._type==="tender"&&d._step&&td){
      ref=String(((td.stepDates||{})[d._step]||{}).reference||"").trim();
    }else if(d._type==="task"||d._type==="contract"){
      title=d.text||"";
      if(d._type==="contract")label=String(d.stageLabel||"Contract").replace("Addum.","Addendum");
    }
    out.push({id:d.id,type:type,label:label,ref:ref,title:title,
      package:d.package||"",tenderRef:d.tenderRef||"",owner:d.owner||"",
      submitted:d.submissionDate||"",due:d.dueDate||"",
      overdue:!!d.overdue,daysOverdue:d.daysOverdue||0});
  });

  (tenders||[]).forEach(function(td){
    if(!withTransmissions[td.id]||td.cancelled)return;
    (td.sdTransmissions||[]).forEach(function(t){
      if(!t.done)return;
      // same rule as SDPanel: a verdict or an answer date stops the clock
      if(t.status==="approved"||t.status==="rejected"||t.approvalDone)return;
      var due=addCalDays(t.done,getDur("clientResponse"));
      var overdue=!!due&&due<todayStr;
      out.push({id:td.id+"_sdtr_"+t.id,type:"SD",label:"SD",ref:String(t.ref||"").trim(),
        title:(td.title||"")+(t.description?" – "+t.description:""),
        package:td.package||"",tenderRef:td.id,owner:td.ownerTender||"",
        submitted:t.done,due:due,overdue:overdue,daysOverdue:overdue?workingDaysDiff(due,todayStr):0});
    });
  });

  return out.filter(function(x){
    if(f.pkg&&f.pkg!=="all"&&x.package!==f.pkg)return false;
    if(f.tender&&f.tender!=="all"&&x.tenderRef!==f.tender)return false;
    if(f.owner&&f.owner!=="all"&&x.owner!==f.owner)return false;
    return true;
  });
}
function clientEmailLine(x){
  var parts=[x.label+(x.ref?" "+x.ref:"")];
  if(x.title)parts.push('"'+x.title+'"');
  if(x.submitted)parts.push("submitted "+clientEmailDate(x.submitted));
  if(x.overdue){
    parts.push(x.daysOverdue>0
      ?"overdue by "+x.daysOverdue+" working day"+(x.daysOverdue===1?"":"s")
      :"overdue since "+clientEmailDate(x.due));
  }else if(x.due)parts.push("due "+clientEmailDate(x.due));
  return parts.join(" – ");
}
function buildClientEmail(items){
  var overdue=items.filter(function(x){return x.overdue;}).sort(function(a,b){
    return (b.daysOverdue-a.daysOverdue)||String(a.due||"").localeCompare(String(b.due||""));
  });
  var pending=items.filter(function(x){return !x.overdue;}).sort(function(a,b){
    return String(a.due||"9999").localeCompare(String(b.due||"9999"));
  });
  var sections=[];
  if(overdue.length)sections.push({title:"Overdue",items:overdue});
  if(pending.length)sections.push({title:"Pending approval, not yet overdue",items:pending});
  var INTRO="We notice that the following documents are with you pending approval:";
  var CLOSE="We would appreciate your review at your earliest convenience.";
  var t=["Dear Client team,","",INTRO,""];
  sections.forEach(function(s){
    t.push("• "+s.title);
    s.items.forEach(function(x){t.push("    ◦ "+clientEmailLine(x));});
    t.push("");
  });
  t.push(CLOSE,"","Kind regards,");
  var h='<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">'+
    '<p>Dear Client team,</p><p>'+INTRO+'</p><ul>'+
    sections.map(function(s){
      return '<li><b>'+s.title+'</b><ul>'+
        s.items.map(function(x){return '<li>'+esc(clientEmailLine(x))+'</li>';}).join("")+
        '</ul></li>';
    }).join("")+
    '</ul><p>'+CLOSE+'</p><p>Kind regards,</p></div>';
  return {text:t.join("\n"),html:h,overdueCount:overdue.length,pendingCount:pending.length};
}
// Resolves to "html", "text" or "" — HTML first so Outlook pastes real nested bullets.
function copyClientEmail(mail){
  try{
    if(window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write){
      return navigator.clipboard.write([new ClipboardItem({
        "text/html":new Blob([mail.html],{type:"text/html"}),
        "text/plain":new Blob([mail.text],{type:"text/plain"})
      })]).then(function(){return "html";}).catch(function(){return clientEmailCopyPlain(mail.text);});
    }
  }catch(e){}
  return clientEmailCopyPlain(mail.text);
}
function clientEmailCopyPlain(text){
  function legacy(){
    try{
      var ta=document.createElement("textarea");
      ta.value=text;ta.style.position="fixed";ta.style.opacity="0";
      document.body.appendChild(ta);ta.select();
      var ok=document.execCommand("copy");
      document.body.removeChild(ta);
      return ok?"text":"";
    }catch(e){return "";}
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text).then(function(){return "text";}).catch(function(){return legacy();});
  }
  return Promise.resolve(legacy());
}
function ClientEmailModal({docs,initialStage,onClose}){
  const [types,setTypes]=useState(function(){
    var only=(initialStage&&initialStage!=="all")?clientEmailTypeOf(initialStage):"";
    var t={};
    CLIENT_EMAIL_TYPES.forEach(function(x){t[x.key]=only?x.key===only:true;});
    return t;
  });
  const [subject,setSubject]=useState("Riviera Tower – Documents pending your approval – "+clientEmailDate(today()));
  const [copied,setCopied]=useState("");
  var list=docs||[];
  var items=list.filter(function(d){return types[d.type];});
  var mail=buildClientEmail(items);
  var mailto="mailto:?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(mail.text.replace(/\n/g,"\r\n"));
  var tooLong=mailto.length>1800;
  var empty=items.length===0;

  return <div className="overlay" onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:760,width:"94vw"}}>
      <div className="modal-hdr">
        <div className="modal-title">✉ Email to the client</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
      </div>
      <div className="modal-body">
        <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:".06em",marginBottom:5}}>Include</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {CLIENT_EMAIL_TYPES.map(function(ty){
            var n=list.filter(function(d){return d.type===ty.key;}).length;
            return <label key={ty.key} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 9px",border:"1px solid #e8e6df",borderRadius:6,
                fontSize:11,textTransform:"none",letterSpacing:"normal",fontWeight:600,margin:0,
                cursor:n?"pointer":"default",opacity:n?1:.45,background:types[ty.key]&&n?"#faf3e0":"#fff"}}>
              <input type="checkbox" checked={!!types[ty.key]} disabled={!n}
                onChange={function(e){var nt=Object.assign({},types);nt[ty.key]=e.target.checked;setTypes(nt);setCopied("");}}
                style={{width:12,height:12}}/>
              {ty.label} <span style={{color:"#888",fontWeight:400}}>{n}</span>
            </label>;
          })}
        </div>
        <div className="fg">
          <label>Subject</label>
          <div style={{display:"flex",gap:6}}>
            <input type="text" value={subject} onChange={function(e){setSubject(e.target.value);}} style={{flex:1}}/>
            <button className="btn btn-sm" title="Copy the subject" onClick={function(){clientEmailCopyPlain(subject);}}>📋</button>
          </div>
        </div>
        <div style={{fontSize:11,color:"#888",margin:"4px 0 6px"}}>{mail.overdueCount} overdue · {mail.pendingCount} not yet overdue</div>
        {empty
          ?<div className="empty" style={{padding:"18px 0"}}><div className="empty-txt">No document selected.</div></div>
          :<pre style={{whiteSpace:"pre-wrap",fontFamily:"Calibri,Arial,sans-serif",fontSize:12.5,lineHeight:1.55,margin:0,
              padding:"12px 14px",border:"1px solid #e8e6df",borderRadius:8,background:"#fff",maxHeight:"45vh",overflowY:"auto"}}>{mail.text}</pre>}
      </div>
      <div className="modal-footer">
        {copied&&<span style={{fontSize:11,fontWeight:700,marginRight:"auto",color:copied==="fail"?"#c62828":"#2e7d32"}}>
          {copied==="html"?"✓ Copied — paste into Outlook":copied==="text"?"✓ Copied as plain text":"Copy failed — select the preview and copy it by hand"}</span>}
        <button className="btn" onClick={onClose}>Close</button>
        <span title={tooLong?"Too long for a mail link: Outlook would cut the text. Use Copy instead.":""}>
          <button className="btn" disabled={empty||tooLong} onClick={function(){window.location.href=mailto;}}>✉ Open in mail</button>
        </span>
        <button className="btn btn-gold" disabled={empty}
          onClick={function(){copyClientEmail(mail).then(function(r){setCopied(r||"fail");});}}>📋 Copy for Outlook</button>
      </div>
    </div>
  </div>;
}

function ClientSubmissionsView({tasks,tenders,contractors,packages,people,saveTasks,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [fTender,setFTender]=useState(mem.fTender||"all");
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fOwner,setFOwner]=useState(mem.fOwner||"all");
  const [fStage,setFStage]=useState(mem.fStage||"all");
  const [fScope,setFScope]=useState(mem.fScope||"overdue");
  useEffect(function(){if(setMemory)setMemory({fTender:fTender,fPkg:fPkg,fOwner:fOwner,fStage:fStage,fScope:fScope});},[fTender,fPkg,fOwner,fStage,fScope]);
  const [showEmail,setShowEmail]=useState(false);
  // The email follows the package / tender / owner filters. Types are ticked inside the
  // email window, and the email always shows both sections, so scope is not applied.
  var emailDocs=React.useMemo(function(){
    return collectClientEmailDocs(tasks,tenders,contractors,{pkg:fPkg,tender:fTender,owner:fOwner});
  },[tasks,tenders,contractors,fPkg,fTender,fOwner]);

  var STAGES=[
    {key:"acc",label:"Tender",color:"#1a73e8",bg:"#dce8ff"},
    {key:"mar",label:"MAR",color:"#6a1b9a",bg:"#f3e5f5"},
    {key:"mss",label:"MSS",color:"#1565c0",bg:"#e3f2fd"},
    {key:"wms",label:"WMS",color:"#00838f",bg:"#e0f7fa"},
    {key:"itp",label:"ITP",color:"#2e7d32",bg:"#e8f5e9"}
  ];

  // This view answers one question: what is sitting on the client's desk right now.
  // Only the five document types that go for approval, and only while they are submitted
  // and still unanswered.
  var PENDING_STAGES=["mar","mss","wms","itp","acc"];
  var allDocs=buildTrackedDocs(tasks,tenders,contractors).filter(function(d){
    return PENDING_STAGES.indexOf(d.stage)>=0&&d.withClient;
  });
  var withClient=allDocs;

  var filtered=allDocs.filter(function(d){
    if(fScope==="overdue"&&!d.overdue)return false;
    if(fScope==="withclient"&&!d.withClient)return false;
    if(fTender!=="all"&&d.tenderRef!==fTender)return false;
    if(fPkg!=="all"&&d.package!==fPkg)return false;
    if(fOwner!=="all"&&d.owner!==fOwner)return false;
    if(fStage!=="all"&&d.stage!==fStage)return false;
    return true;
  }).sort(function(a,b){
    if(a.overdue&&!b.overdue)return -1;
    if(!a.overdue&&b.overdue)return 1;
    return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
  });

  var overdueCount=allDocs.filter(function(d){return d.overdue;}).length;
  var allOwners=[...new Set(allDocs.map(function(d){return d.owner;}).filter(Boolean))].sort();
  var allTenders=[...new Set(allDocs.map(function(d){return d.tenderRef;}).filter(Boolean))].map(function(id){return(tenders||[]).find(function(t){return t.id===id;});}).filter(Boolean);

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr">
      <div>
        <div className="page-title">📬 Client Follow-up</div>
        <div className="page-sub">Everything currently with the client — RFI, FCR, ACC/ACONEX, MAR, MSS, ITP, WMS, SD, Contract docs</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {overdueCount>0&&<div style={{padding:"8px 16px",background:"#fce4ec",border:"1.5px solid #f5c6cb",borderRadius:10,color:"#c62828",fontWeight:700,fontSize:13}}>⚠️ {overdueCount} overdue</div>}
        <div style={{padding:"8px 16px",background:"#e3f2fd",border:"1.5px solid #90caf9",borderRadius:10,color:"#1565c0",fontWeight:700,fontSize:13}}>📬 {withClient.length} with client</div>
        <button className="btn btn-gold" disabled={emailDocs.length===0}
          title={emailDocs.length===0?"Nothing pending with the client for these filters":"Draft an email to the client listing every document pending approval"}
          onClick={function(){setShowEmail(true);}}>✉ Client email</button>
      </div>
    </div>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <button className={"fchip"+(fScope==="overdue"?" on":"")} onClick={function(){setFScope("overdue");}} style={fScope==="overdue"?{borderColor:"#c62828",background:"#c62828",color:"#fff"}:{}}>⚠️ Overdue</button>
      <button className={"fchip"+(fScope==="withclient"?" on":"")} onClick={function(){setFScope("withclient");}} style={fScope==="withclient"?{borderColor:"#1565c0",background:"#1565c0",color:"#fff"}:{}}>📬 With client</button>
      <button className={"fchip"+(fScope==="all"?" on":"")} onClick={function(){setFScope("all");}}>All</button>
      <select value={fStage} onChange={function(e){setFStage(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All stages</option>
        {STAGES.map(function(s){return <option key={s.key} value={s.key}>{s.label}</option>;})}
      </select>
      <select value={fPkg} onChange={function(e){setFPkg(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All packages</option>
        {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      <select value={fTender} onChange={function(e){setFTender(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All tenders</option>
        {allTenders.sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
      </select>
      <select value={fOwner} onChange={function(e){setFOwner(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All owners</option>
        {allOwners.map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
      </select>
      {(fTender!=="all"||fPkg!=="all"||fOwner!=="all"||fStage!=="all"||fScope!=="overdue")&&
        <button className="btn btn-sm" onClick={function(){setFTender("all");setFPkg("all");setFOwner("all");setFStage("all");setFScope("overdue");}}>✕ Reset</button>}
    </div>

    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">✅</div><div className="empty-txt">Nothing currently pending with the client.</div></div>
      :<div>
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {STAGES.map(function(s){
            var cnt=withClient.filter(function(d){return d.stage===s.key;}).length;
            if(cnt===0)return null;
            return <div key={s.key} onClick={function(){setFStage(s.key);}} style={{padding:"6px 12px",borderRadius:8,background:s.bg,border:"1.5px solid "+s.color,cursor:"pointer",display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:13,color:s.color}}>{cnt}</span>
              <span style={{fontSize:11,color:s.color}}>{s.label}</span>
            </div>;
          })}
        </div>
        <div style={{background:"#fff",borderRadius:12,border:"1px solid #ede9e3",overflow:"hidden"}}>
          <table className="tbl" style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr>
                <th>Stage</th><th>Item</th><th>Tender</th><th>Package</th><th>Owner</th>
                <th>Submitted</th><th>Response due (+14d)</th><th>Days pending</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(d){
                var stage=STAGES.find(function(s){return s.key===d.stage;})||{color:"#888",bg:"#f5f5f5",label:d.stage};
                var daysPending=d.submissionDate?workingDaysDiff(d.submissionDate,today()):0;
                return <tr key={d.id} style={{background:d.overdue?"#fffaf9":"#fff"}}>
                  <td><span style={{padding:"2px 8px",borderRadius:8,background:stage.bg,color:stage.color,fontWeight:700,fontSize:11}}>{stage.label}</span></td>
                  <td style={{maxWidth:280}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:d.tenderRef?"pointer":"default",color:d.tenderRef?"#1a1a1a":"#555"}} onClick={function(){if(d.tenderRef&&onNavTender)onNavTender(d.tenderRef,"submissions");}}>{d.text}</div>
                  </td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.tenderTitle&&d.tenderRef?<button onClick={function(){if(onNavTender)onNavTender(d.tenderRef,"submissions");}} style={{background:"none",border:"none",cursor:"pointer",color:"#3949ab",fontSize:11,fontWeight:500,textDecoration:"underline",padding:0,fontFamily:"inherit"}}>{d.tenderTitle}</button>:<span style={{color:"#888"}}>{d.tenderTitle||"—"}</span>}</td>
                  <td style={{fontSize:11,color:"#888",whiteSpace:"nowrap"}}>{d.package||"—"}</td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.owner?(d.owner.split(",")[0]):"—"}</td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.submissionDate?fmtDate(d.submissionDate):"—"}</td>
                  <td style={{fontSize:11,fontWeight:d.overdue?700:400,color:d.overdue?"#c62828":"#555",whiteSpace:"nowrap"}}>{d.dueDate?fmtDate(d.dueDate):"—"}</td>
                  <td style={{textAlign:"center"}}>{d.overdue?<span style={{fontWeight:700,color:"#c62828",fontSize:12}}>⚠️ +{d.daysOverdue}d</span>:<span style={{fontSize:11,color:"#888"}}>{daysPending}d</span>}</td>
                  <td><span style={{fontSize:11,padding:"2px 7px",borderRadius:8,background:"#fff8e1",color:"#f57f17",fontWeight:600}}>{d.stepStatus||d.status||"Pending"}</span></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>}
    {showEmail&&<ClientEmailModal docs={emailDocs} initialStage={fStage} onClose={function(){setShowEmail(false);}}/>}
  </div>;
}

// Cross-tender view of the two quality documents. Same shape as Materials: one row per
// document per tender, so the whole project can be swept in one screen.
// ---------------------------------------------------------------------------
// Action timeline — a horizontal frieze.
// Weeks run left to right; each lane is an owner, a tender or a zone. An action sits on
// its due date. The point is to see collisions: three blocking points landing on the same
// person in the same week is invisible in a list and obvious here.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Minutes of meeting.
// Mirrors the Word template: a header block, a participants table, then numbered
// sections each holding items with an action owner, a due date and a status.
// An item can be pushed into the app's action list, and stays linked to the MoM.
// ---------------------------------------------------------------------------
// Cross-tender view of the WMS and ITP: one row per document per tender, so the whole
// project can be swept in one screen. Everything is read from the same submission cycles
// as the tender sheet (tenderDocs / docSummary), so this view and the tender always agree.
// Revisions are recorded in the tender (Submission steps → WMS & ITP), where they also open
// and close the automatic actions: the tender name opens it. Only the reference is written
// from here, because it has no automatic action attached.
function QualityDocsView({tenders,packages,saveTenders,onNavTender,memory,setMemory}){
  var mem=memory||{};
  var QD_FILTERS={late:"Late — not submitted",overdue:"Client answer overdue",returned:"To resubmit",
    pending:"With client",none:"Not submitted",approved:"Approved"};
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fKind,setFKind]=useState(mem.fKind==="WMS"||mem.fKind==="ITP"?mem.fKind:"all");
  const [fStatus,setFStatus]=useState(QD_FILTERS[mem.fStatus]?mem.fStatus:"all");
  const [q,setQ]=useState(mem.q||"");
  useEffect(function(){if(setMemory)setMemory({fPkg:fPkg,fKind:fKind,fStatus:fStatus,q:q});},[fPkg,fKind,fStatus,q]);

  var now=today();
  var KIND_COL={WMS:["#e0f7fa","#00838f"],ITP:["#e8f5e9","#2e7d32"]};
  var RANK={late:0,overdue:1,returned:2,pending:3,none:4,approved:5,na:6};

  var rows=[];
  (tenders||[]).forEach(function(td){
    if(td.cancelled)return;
    var docs=tenderDocs(td);
    ["wms","itp"].forEach(function(k){
      var d=docs.find(function(x){return x.id===k;});
      if(!d)return;
      var na=((td.steps||{})[k]||"")==="N/A";
      var s=docSummary(d,now);
      var sd=((td.stepDates||{})[k])||{};
      var due=sd.target||d.theoSub||"";
      var late=!na&&s.state==="none"&&isValidDate(due)&&due<now;
      var key=na?"na":late?"late":s.overdue?"overdue":s.state;
      rows.push({td:td,k:k,kind:k.toUpperCase(),d:d,s:s,sd:sd,due:due,na:na,key:key,
        last:d.cycles[d.cycles.length-1]||null});
    });
  });

  // Package, kind and search first: the counters show what is left before the status filter.
  var scoped=rows.filter(function(r){
    if(fPkg!=="all"&&(r.td.package||"")!==fPkg)return false;
    if(fKind!=="all"&&r.kind!==fKind)return false;
    if(q){var lq=q.toLowerCase();
      if(!(r.td.title||"").toLowerCase().includes(lq)&&!(r.td.package||"").toLowerCase().includes(lq)
        &&!String(r.sd.reference||"").toLowerCase().includes(lq))return false;}
    return true;
  });
  function matches(r,f){
    if(f==="all")return true;
    if(f==="late"||f==="overdue")return r.key===f;
    if(r.na)return false;
    return r.s.state===f;
  }
  var shown=scoped.filter(function(r){return matches(r,fStatus);}).sort(function(a,b){
    return (RANK[a.key]-RANK[b.key])||String(a.due||"9999").localeCompare(String(b.due||"9999"))
      ||(a.td.title||"").localeCompare(b.td.title||"");
  });
  var counts={};
  Object.keys(QD_FILTERS).forEach(function(f){counts[f]=scoped.filter(function(r){return matches(r,f);}).length;});

  // One write per edit.
  function updRef(td,k,val){
    var d=(tenders||[]).map(function(t){
      if(t.id!==td.id)return t;
      var sd=Object.assign({},t.stepDates||{});
      sd[k]=Object.assign({},sd[k]||{},{reference:val});
      return Object.assign({},t,{stepDates:sd});
    });
    saveTenders(d);
  }

  function statusCell(r){
    if(r.na)return <span title="Not applicable — nothing to do" style={{fontSize:10,color:"#2e7d32",fontWeight:700,background:"#e8f5e9",border:"1px solid #c8e6c9",padding:"1px 6px",borderRadius:4}}>N/A</span>;
    if(r.key==="late")return <span style={{fontSize:11,fontWeight:700,color:"#c62828"}}
      title="Not submitted and the due date has passed">⚠ Not submitted · due {fmtDate(r.due)}</span>;
    var col={approved:"#1e6b3a",pending:"#1a73e8",returned:"#b35c00",none:"#9b968b"}[r.s.state];
    return <span style={{fontSize:11,fontWeight:600,color:col,display:"inline-flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
      {r.s.codes.filter(Boolean).map(function(c,i){var k=FLOW_CODE_COL[c];
        return <span key={i} style={{background:k[0],color:k[1],border:"1px solid "+k[1],borderRadius:3,fontSize:9.5,padding:"0 3px"}}>{c}</span>;})}
      {r.s.text}<OverdueTag o={r.s.overdue}/></span>;
  }

  var chipCol={late:"#c62828",overdue:"#c62828",returned:"#b35c00",pending:"#1a73e8",none:"#6f6b62",approved:"#1e6b3a"};
  var pkgList=(packages&&packages.length?packages:[...new Set((tenders||[]).map(function(t){return t.package;}).filter(Boolean))]).slice().sort();

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr">
      <div>
        <div className="page-title">🛡️ WMS / ITP</div>
        <div className="page-sub">{shown.length} document{shown.length!==1?"s":""} across {new Set(shown.map(function(r){return r.td.id;})).size} tenders · revisions are recorded in each tender, under Submission steps → WMS &amp; ITP</div>
      </div>
    </div>

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
      {Object.keys(QD_FILTERS).map(function(f){
        var on=fStatus===f;var n=counts[f];
        return <button key={f} className="btn btn-sm" disabled={!n&&!on} onClick={function(){setFStatus(on?"all":f);}}
          style={{borderRadius:16,display:"inline-flex",gap:6,alignItems:"center",opacity:n||on?1:.45,
            background:on?chipCol[f]:"#fff",color:on?"#fff":chipCol[f],borderColor:on?chipCol[f]:"#d9d5ca"}}>
          {QD_FILTERS[f]}<span style={{fontSize:10,fontWeight:700}}>{n}</span></button>;
      })}
    </div>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Tender, package, reference…" style={{width:220,padding:"5px 10px",fontSize:12}}/>
      <select value={fPkg} onChange={function(e){setFPkg(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All packages</option>
        {pkgList.map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      <select value={fKind} onChange={function(e){setFKind(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">WMS and ITP</option><option value="WMS">WMS only</option><option value="ITP">ITP only</option>
      </select>
      {(fPkg!=="all"||fKind!=="all"||fStatus!=="all"||q)&&
        <button className="btn btn-sm" onClick={function(){setFPkg("all");setFKind("all");setFStatus("all");setQ("");}}>✕ Reset</button>}
    </div>

    {shown.length===0
      ?<div className="empty"><div className="empty-ico">🛡️</div><div className="empty-txt">No WMS or ITP matches these filters.</div></div>
      :<div style={{background:"#fff",borderRadius:12,border:"1px solid #ede9e3",overflow:"hidden"}}>
        <table className="tbl" style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>
            <th>Tender</th><th>Package</th><th>Doc</th>
            <th style={{textAlign:"center"}} title="Earliest schedule task linked to the tender">Start on site</th>
            <th style={{textAlign:"center"}} title="Start on site minus the lead time set in Settings › Durations">Theoretical</th>
            <th style={{textAlign:"center"}}>Target</th>
            <th style={{minWidth:200}}>Status</th>
            <th style={{textAlign:"center"}} title="Date the latest revision was sent to the client">Submitted</th>
            <th style={{minWidth:110}}>Reference</th>
          </tr></thead>
          <tbody>{shown.map(function(r){
            var kc=KIND_COL[r.kind];
            var lead=r.k==="wms"?getDur("wmsBeforeStart"):getDur("itpBeforeStart");
            var bg=r.key==="late"||r.key==="overdue"?"#fffaf9":"#fff";
            return <tr key={r.td.id+"_"+r.k} style={{background:bg,opacity:r.na?.6:1}}>
              <td style={{fontSize:11,maxWidth:260}}>
                <button onClick={function(){if(onNavTender)onNavTender(r.td.id,"qadocs");}} title="Open the tender to record a submission or a client answer"
                  style={{background:"none",border:"none",cursor:"pointer",color:"#3949ab",fontSize:11,fontWeight:500,textDecoration:"underline",padding:0,fontFamily:"inherit",textAlign:"left"}}>{r.td.title||"(untitled)"}</button>
              </td>
              <td style={{fontSize:11,color:"#888",whiteSpace:"nowrap"}}>{r.td.package||"—"}</td>
              <td><span className="badge" style={{background:kc[0],color:kc[1],fontWeight:700}}>{r.kind}</span></td>
              <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap",color:"#555"}}>{r.td.startOnSite?fmtDate(r.td.startOnSite):<span style={{color:"#ddd"}} title="No schedule task linked to this tender">—</span>}</td>
              <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap"}}>
                {r.d.theoSub
                  ?<span title={"Start on site "+fmtDate(r.td.startOnSite)+" minus "+lead+" days"} style={{color:"#8b8578",cursor:"help"}}>{fmtDate(r.d.theoSub)}</span>
                  :<span style={{color:"#ddd"}}>—</span>}
              </td>
              <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap",fontWeight:r.sd.target?600:400}}>{r.sd.target?fmtDate(r.sd.target):<span style={{color:"#ddd"}}>—</span>}</td>
              <td>{statusCell(r)}</td>
              <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap"}}>
                {r.last&&r.last.submitted
                  ?<span>{fmtDate(r.last.submitted)}{r.last.rev>0&&<span style={{fontSize:9.5,color:"#b35c00",fontWeight:700,marginLeft:4}}>R{r.last.rev}</span>}</span>
                  :<span style={{color:"#ddd"}}>—</span>}
              </td>
              <td><input type="text" value={r.sd.reference||""} onChange={function(e){updRef(r.td,r.k,e.target.value);}}
                placeholder="Ref…" title="Transmittal or document number"
                style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 6px",width:"100%",boxSizing:"border-box"}}/></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </div>;
}

function MaterialsView({tenders,packages,people,saveTenders,onNavTender,memory,setMemory,tasks,saveTasks,pkgOwners}){
  // Everything about a MAR / MSS is edited here too — status, submission and its reference,
  // real dates, client code, resubmission — through the same writers as the package sheet
  // (matDoc / recordDocSubmission / DocRevisionsEditor), so both views stay identical.
  const [openDoc,setOpenDoc]=useState({});
  function toggleDoc(id){setOpenDoc(function(o){var n=Object.assign({},o);n[id]=!o[id];return n;});}
  function ownerOf(td){return (pkgOwners||window._ppPkgOwners||{})[td.package||""]||td.ownerTender||"";}
  function updTdFor(td){
    return function(field,val){
      if(isReadOnly())return;
      var patch=(field&&typeof field==="object")?field:{[field]:val};
      saveTenders((tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,patch);}));
    };
  }
  function afterSaveFor(td){
    return function(prev,next){
      if(!saveTasks||!tasks)return;
      var n=flowTaskChanges(prev,next,tasks,ownerOf(next));
      if(n)saveTasks(n);
    };
  }
  function docActionStats(tdId,matId,kind){
    var ref=tdId+"::"+matId+"::"+kind.toLowerCase();
    var acts=(tasks||[]).filter(function(t){return t.materialDocRef===ref&&t.status!=="done";});
    var late=acts.filter(function(t){return t.due&&t.due<today();}).length;
    return{n:acts.length,late:late};
  }
  var mem=memory||{};
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fTender,setFTender]=useState(mem.fTender||"all");
  // Same states as the tender's Materials table and Flow & history → Submissions.
  var MAT_FILTERS={prep:"Under preparation",none:"Not submitted",pending:"With client",returned:"To resubmit",approved:"Approved"};
  const [fStatus,setFStatus]=useState(MAT_FILTERS[mem.fStatus]?mem.fStatus:"all");
  const [q,setQ]=useState(mem.q||"");
  useEffect(function(){if(setMemory)setMemory({fPkg:fPkg,fTender:fTender,fStatus:fStatus,q:q});},[fPkg,fTender,fStatus,q]);

  // Filter key of one document: its submission state, or "prep" / "none" before it is sent.
  function docKey(r,k){
    var st=docSummary(matDoc(r.td,r.mat,r.mi,k)).state;
    return st!=="none"?st:(r.mat[k+"Status"]==="under preparation"?"prep":"none");
  }
  // One cell: status, submission (date, revision, reference) and the client's answer.
  // ＋ Record asks the reference; ▸ opens the revisions underneath (dates, code, resubmission).
  function docCell(r,k){
    if(matDocKinds(r.mat).indexOf(k)<0)return <span style={{color:"#ddd",fontSize:10}} title="No MSS required for this material — tick MSS in the Material column">n/a</span>;
    var doc=matDoc(r.td,r.mat,r.mi,k);
    var last=doc.cycles[doc.cycles.length-1];
    var key=r.td.id+"|"+doc.id;
    var ro=isReadOnly();
    return <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <button type="button" onClick={function(){toggleDoc(key);}} title="Revisions: real submission date, returned date, code, reference, resubmission"
          style={{background:"none",border:"none",cursor:"pointer",padding:0,fontSize:11,color:"#8b8578",fontFamily:"inherit"}}>{openDoc[key]?"▾":"▸"}</button>
        <div style={{flex:1}}><MatDocStatus doc={doc} prep={r.mat[k+"Status"]==="under preparation"} onPrep={ro?null:function(v){setPrep(r,k,v);}}/></div>
      </div>
      {last&&last.submitted&&<div style={{fontSize:10.5,color:"#555",whiteSpace:"nowrap"}}>sent {fmtDate(last.submitted)}{last.rev>0&&<b style={{color:"#b35c00",marginLeft:3}}>R{last.rev}</b>}
        {doc.ref?<span style={{fontFamily:"var(--font-mono)",color:"#1a73e8",marginLeft:5}}>{doc.ref}</span>:<span style={{color:"#c62828",fontWeight:700,marginLeft:5}}>⚠ ref.</span>}</div>}
      <MatDocApproval doc={doc}/>
      {!ro&&canAddCycle(doc.cycles)&&<button type="button" className="btn btn-sm" style={{fontSize:10,padding:"0 7px",height:22,alignSelf:"flex-start"}}
        onClick={function(){recordDocSubmission(r.td,doc,updTdFor(r.td),afterSaveFor(r.td)).then(function(p){if(p)setOpenDoc(function(o){var n=Object.assign({},o);n[key]=true;return n;});});}}>
        {doc.cycles.length?"↻ Resubmit R"+(last.rev+1):"＋ Record submission"}</button>}
    </div>;
  }
  function setPrep(r,k,v){
    updMat(r.td,r.mi,k+"Status",v);
    if(saveTasks&&tasks){var u={};u[k+"Status"]=v;saveTasks(matPrepTasks(r.td,Object.assign({},r.mat,u),k.toUpperCase(),v,tasks,ownerOf(r.td)));}
  }

  var rows=[];
  (tenders||[]).forEach(function(td){
    if(fPkg!=="all"&&td.package!==fPkg)return;
    if(fTender!=="all"&&td.id!==fTender)return;
    (td.materials||[]).forEach(function(mat,mi){
      rows.push({td:td,mat:mat,mi:mi});
    });
  });

  var filtered=rows.filter(function(r){
    if(q){var lq=q.toLowerCase();if(!(r.mat.name||"").toLowerCase().includes(lq)&&!(r.td.title||"").toLowerCase().includes(lq))return false;}
    if(fStatus!=="all"){
      if(!matDocKinds(r.mat).some(function(k){return docKey(r,k)===fStatus;}))return false;
    }
    return true;
  });

  function updMat(td,mi,field,val){
    if(blockIfReadOnly())return;
    var ms=(td.materials||[]).map(function(m,j){return j!==mi?m:Object.assign({},m,{[field]:val});});
    var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{materials:ms});});
    saveTenders(d);
  }

  var allPkgTenders=(tenders||[]).filter(function(t){return fPkg==="all"||t.package===fPkg;});

  const [showAddModal,setShowAddModal]=useState(false);
  const [addTenderId,setAddTenderId]=useState("");

  function addMaterial(tenderId){
    var t=(tenders||[]).find(function(x){return x.id===tenderId;});
    if(!t)return;
    var newMat={id:uuid(),name:"",specified:"",proposed:"",leadTime:"",
      mssStatus:"",mssTarget:"",mssDone:"",mssApprovalStatus:"",mssApprovalTarget:"",mssApprovalDone:"",mssReview:"",mssLink:"",mssLinkLabel:"",mssNumber:"",
      marStatus:"",marTarget:"",marDone:"",marApprovalStatus:"",marApprovalTarget:"",marApprovalDone:"",marReview:"",marLink:"",marLinkLabel:"",marNumber:"",
      hasPO:false,poNumber:"",poStatus:""};
    var ms=[...(t.materials||[]),newMat];
    var d=(tenders||[]).map(function(x){return x.id!==tenderId?x:Object.assign({},x,{materials:ms});});
    saveTenders(d);
    setShowAddModal(false);
    setAddTenderId("");
  }

  function handleAddClick(){
    if(fTender!=="all"){addMaterial(fTender);}
    else{setShowAddModal(true);}
  }

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr">
      <div>
        <div className="page-title">🏗️ Materials</div>
        <div className="page-sub">{filtered.length} materials across {new Set(filtered.map(function(r){return r.td.id;})).size} packages — MSS / MAR edited here: status, submissions and references, dates, client codes</div>
      </div>
      <button className="btn btn-gold" onClick={handleAddClick}>＋ Add Material</button>
    </div>

    {showAddModal&&<div className="overlay" onClick={function(e){if(e.target===e.currentTarget){setShowAddModal(false);setAddTenderId("");}}}>
      <div className="modal" style={{maxWidth:420}}>
        <div className="modal-hdr">
          <div className="modal-title">＋ Add Material</div>
          <button onClick={function(){setShowAddModal(false);setAddTenderId("");}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <label>Tender</label>
            <select value={addTenderId} onChange={function(e){setAddTenderId(e.target.value);}} autoFocus>
              <option value="">— select a tender —</option>
              {allPkgTenders.slice().sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}{t.package?" ("+t.package+")":""}</option>;})}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={function(){setShowAddModal(false);setAddTenderId("");}}>Cancel</button>
          <button className="btn btn-pri" disabled={!addTenderId} onClick={function(){addMaterial(addTenderId);}}>＋ Add Material</button>
        </div>
      </div>
    </div>}

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Search material, tender…" style={{width:200,padding:"5px 10px",fontSize:12}}/>
      <select value={fPkg} onChange={function(e){setFPkg(e.target.value);if(fTender!=="all"){var t=(tenders||[]).find(function(x){return x.id===fTender;});if(t&&t.package!==e.target.value)setFTender("all");}}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All departments</option>
        {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      <select value={fTender} onChange={function(e){setFTender(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All packages</option>
        {allPkgTenders.slice().sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
      </select>
      <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All statuses</option>
        {Object.keys(MAT_FILTERS).map(function(k){return <option key={k} value={k}>{MAT_FILTERS[k]}</option>;})}
      </select>
      {(fPkg!=="all"||fTender!=="all"||fStatus!=="all"||q)&&
        <button className="btn btn-sm" onClick={function(){setFPkg("all");setFTender("all");setFStatus("all");setQ("");}}>✕ Reset</button>}
    </div>

    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">🏗️</div><div className="empty-txt">No materials found.</div></div>
      :<div style={{background:"#fff",borderRadius:12,border:"1px solid #ede9e3",overflow:"hidden"}}>
        <table className="tbl tbl-cards" style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <th>Package</th><th>Dept.</th><th>Material</th><th>Lead time</th>
              <th>MSS</th><th>MSS Target</th><th style={{textAlign:"center"}}>MSS Act.</th>
              <th>MAR</th><th>MAR Target</th><th style={{textAlign:"center"}}>MAR Act.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(function(r,idx){
              var openKinds=matDocKinds(r.mat).filter(function(k){return openDoc[r.td.id+"|"+matDocId(r.mat,r.mi,k)];});
              return <React.Fragment key={r.td.id+"_"+r.mi}><tr style={{verticalAlign:"top"}}>
                <td data-l="Package" style={{fontSize:11,whiteSpace:"nowrap"}}>
                  <button onClick={function(){if(onNavTender)onNavTender(r.td.id,"materials");}} style={{background:"none",border:"none",cursor:"pointer",color:"#3949ab",fontSize:11,fontWeight:500,textDecoration:"underline",padding:0,fontFamily:"inherit"}}>{r.td.title}</button>
                </td>
                <td data-l="Dept." style={{fontSize:11,color:"#888"}}>{r.td.package||"—"}</td>
                <td data-l="Material" className="card-main" style={{minWidth:140}}>
                  <input type="text" value={r.mat.name||""} onChange={function(e){updMat(r.td,r.mi,"name",e.target.value);}} placeholder="Material name" style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid #e8e6df",borderRadius:4,fontWeight:600,boxSizing:"border-box"}}/>
                  <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:10.5,fontWeight:500,margin:"4px 0 0",fontFamily:"inherit"}}
                    title={cyclesOfMat(r.mat,"mss").length&&!r.mat.hasMSS?"This MSS already has submissions, so it stays listed":"This material requires a Material Submission Sheet"}>
                    <input type="checkbox" checked={!!r.mat.hasMSS} onChange={function(e){updMat(r.td,r.mi,"hasMSS",e.target.checked);}} style={{width:12,height:12}}/>MSS required</label>
                </td>
                <td data-l="Lead time"><input type="text" value={r.mat.leadTime||""} onChange={function(e){updMat(r.td,r.mi,"leadTime",e.target.value);}} placeholder="e.g. 12 wks" style={{width:80,fontSize:11,padding:"3px 5px",border:"1px solid #e8e6df",borderRadius:4}}/></td>
                <td data-l="MSS" style={{minWidth:120}}>{docCell(r,"mss")}</td>
                <td data-l="MSS target"><input type="date" min="1990-01-01" max="2200-12-31" value={r.mat.mssTarget||""} onChange={function(e){updMat(r.td,r.mi,"mssTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #e8e6df",borderRadius:4}}/></td>
                <td data-l="MSS actions" style={{textAlign:"center"}}>{(function(){var s=docActionStats(r.td.id,r.mat.id,"MSS");return s.n===0?<span style={{color:"#ddd",fontSize:10}}>—</span>:<span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:8,background:s.late>0?"#fce4ec":"#f0ede6",color:s.late>0?"#c62828":"#666"}}>⚑ {s.n}{s.late>0?" ⚠":""}</span>;})()}</td>
                <td data-l="MAR" style={{minWidth:120}}>{docCell(r,"mar")}</td>
                <td data-l="MAR target"><input type="date" min="1990-01-01" max="2200-12-31" value={r.mat.marTarget||""} onChange={function(e){updMat(r.td,r.mi,"marTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #e8e6df",borderRadius:4}}/></td>
                <td data-l="MAR actions" style={{textAlign:"center"}}>{(function(){var s=docActionStats(r.td.id,r.mat.id,"MAR");return s.n===0?<span style={{color:"#ddd",fontSize:10}}>—</span>:<span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:8,background:s.late>0?"#fce4ec":"#f0ede6",color:s.late>0?"#c62828":"#666"}}>⚑ {s.n}{s.late>0?" ⚠":""}</span>;})()}</td>
              </tr>
              {openKinds.map(function(k){
                var doc=matDoc(r.td,r.mat,r.mi,k);
                return <tr key={"ed-"+k}><td colSpan={10} style={{background:"#faf9f6",padding:"6px 12px 10px 24px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#6f6b62",marginBottom:2}}>{k.toUpperCase()} — {r.mat.name||"material"} · {r.td.title}</div>
                  <DocRevisionsEditor td={r.td} d={doc} updTd={updTdFor(r.td)} afterSave={afterSaveFor(r.td)}/>
                </td></tr>;
              })}
              </React.Fragment>;
            })}
          </tbody>
        </table>
      </div>}
  </div>;
}

// ---------------------------------------------------------------------------
// Missing information, across every tender (cancelled ones aside), in one window:
// each blank of the general table becomes an input, so it can be filled in one go.
// Drafts stay local until "Save", then everything is written in ONE saveTenders call.
// Only plain fields and step statuses are edited here: nothing that starts actions
// (dates done / approvals stay in the tender sheet).
// ---------------------------------------------------------------------------
var TENDER_GAP_FIELDS=[
  {k:"package",label:"Package",kind:"package"},
  {k:"ownerTender",label:"Owner",kind:"person"},
  {k:"budget",label:"Budget",kind:"number"},
  {k:"startOnSite",label:"Target start",kind:"date"},
  {k:"step:pkg",label:"Tender Package",kind:"step"},
  {k:"step:acc",label:"ACC/Aconex",kind:"step"},
  {k:"proposed",label:"Proposed",kind:"number",tip:"ACC amount, once the ACC is approved"},
  {k:"awarded",label:"Awarded to",kind:"open",tip:"Recorded in the tender's Awards panel"},
  {k:"instructionNumber",label:"Instruction no.",kind:"text",tip:"Once the contract is signed"},
  {k:"instructionAmount",label:"Instructed",kind:"number",tip:"Once the contract is signed"},
  {k:"step:itp",label:"ITP",kind:"step"},
  {k:"step:wms",label:"WMS",kind:"step"}
];
function _gapBlank(v){return v===undefined||v===null||String(v).trim()===""||v==="—";}
// Which of TENDER_GAP_FIELDS are missing for this tender. A field that only makes sense
// later in the process (proposed, instruction…) is only asked for once that stage is reached.
function tenderGaps(td){
  if(td.cancelled)return[];
  var ph=tenderPhase(td),st=td.steps||{},out=[];
  TENDER_GAP_FIELDS.forEach(function(f){
    var miss=false;
    if(f.kind==="step"){
      var key=f.k.slice(5);
      miss=_gapBlank(st[key])&&flowDocState(td,key)==="none";
    }
    else if(f.k==="budget")miss=!Number(td.budget);
    else if(f.k==="proposed")miss=(ph==="ctr"||ph==="sig")&&!(Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0));
    else if(f.k==="awarded")miss=(ph==="ctr"||ph==="sig")&&!(td.awards||[]).some(function(a){return a.subcontractor;})&&!td.contractor;
    else if(f.k==="instructionNumber"||f.k==="instructionAmount")miss=ph==="sig"&&_gapBlank(f.k==="instructionAmount"&&!Number(td.instructionAmount)?"":td[f.k]);
    else miss=_gapBlank(td[f.k]);
    if(miss)out.push(f.k);
  });
  return out;
}
// ── Packages list print ────────────────────────────────────────────────────
// The live table is printed (same badges and colours as on screen) with only the column
// families ticked in the window, then zoomed down so its whole width fits on the sheet.
var TP_SECTIONS=[
  {k:"fin",label:"Finance",hint:"Budget, proposed, instructed, instruction, variance"},
  {k:"dat",label:"Dates",hint:"Target start, new starting date"},
  {k:"sub",label:"Submission steps",hint:"One column per step"},
  {k:"fol",label:"Follow-up",hint:"Next step"},
  {k:"tl",label:"Timelines",hint:"Status line and mini timeline under each package"},
  {k:"kpis",label:"Summary cards",hint:"Totals at the top"},
  {k:"legend",label:"Legends",hint:"Colour keys above the table"}
];
var TP_DEFAULT={fin:true,dat:true,sub:true,fol:true,tl:true,kpis:true,legend:true,size:"A4",orient:"landscape"};
function tpLoad(){
  try{var o=JSON.parse(localStorage.getItem("pp_tender_print")||"null");if(o)return Object.assign({},TP_DEFAULT,o);}catch(e){}
  return Object.assign({},TP_DEFAULT);
}
function tenderPrint(o){
  try{localStorage.setItem("pp_tender_print",JSON.stringify(o));}catch(e){}
  var nSteps=TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).length;
  // Cells of a package row: 6 package, 5 finance, 2 dates, the steps, 1 follow-up.
  // The status / phase / totals rows are a single colSpan cell, never hit by these selectors.
  var groups={fin:{g:2,from:7,to:11},dat:{g:3,from:12,to:13},sub:{g:4,from:14,to:13+nSteps},fol:{g:5,from:14+nSteps,to:14+nSteps}};
  var hide=[];
  Object.keys(groups).forEach(function(k){
    if(o[k])return;
    var g=groups[k];
    hide.push("body.printing-tenders .tbl-tenders tr.tgroup-hdr>th:nth-child("+g.g+")");
    for(var c=g.from;c<=g.to;c++){
      hide.push("body.printing-tenders .tbl-tenders thead tr:not(.tgroup-hdr)>th:nth-child("+c+")");
      hide.push("body.printing-tenders .tbl-tenders tbody.tgroup>tr:not(.tp-tl):not(.tphase-hdr)>td:nth-child("+c+")");
    }
  });
  if(!o.tl)hide.push("body.printing-tenders .tp-tl");
  if(!o.kpis)hide.push("body.printing-tenders .tp-kpis");
  if(!o.legend)hide.push("body.printing-tenders .tp-legend");
  var mm=4;
  var W=o.size==="A3"?420:297,H=o.size==="A3"?297:210;
  if(o.orient==="portrait"){var t=W;W=H;H=t;}
  var pageW=Math.floor((W-2*mm)*96/25.4);
  var st=document.createElement("style");
  st.textContent="@page{size:"+W+"mm "+H+"mm;margin:"+mm+"mm}"+(hide.length?hide.join(",")+"{display:none!important}":"");
  document.head.appendChild(st);
  var body=document.body;
  body.classList.add("printing-tenders");
  var content=document.querySelector(".content");
  var wrap=document.querySelector(".tp-table");
  var prevW=content?content.style.width:"";
  // Lay the page out at the printable width, then shrink the table if it still overflows.
  if(content)content.style.width=pageW+"px";
  // The today line is placed in pixels from the screen layout; React would only move it
  // after the print, so it is re-placed here on the print layout (before the zoom).
  var rail=wrap&&wrap.querySelector("[data-tl-rail]"),railPrev=null;
  if(rail){
    var holder=rail.parentNode,rp=tlRailPos(wrap,{from:holder.getAttribute("data-from"),to:holder.getAttribute("data-to")});
    railPrev={left:rail.style.left,top:rail.style.top,height:rail.style.height,display:rail.style.display};
    if(rp){rail.style.left=rp.left+"px";rail.style.top=rp.top+"px";rail.style.height=rp.height+"px";}
    else rail.style.display="none";
  }
  if(wrap){
    var tbl=wrap.querySelector("table");
    var need=tbl?tbl.scrollWidth:pageW;
    wrap.style.zoom=need>pageW?String(pageW/need):"";
  }
  var done=false;
  function restore(){
    if(done)return;done=true;
    body.classList.remove("printing-tenders");
    if(st.parentNode)st.parentNode.removeChild(st);
    if(content)content.style.width=prevW;
    if(wrap)wrap.style.zoom="";
    if(rail&&railPrev)Object.assign(rail.style,railPrev);
    window.removeEventListener("afterprint",restore);
  }
  window.addEventListener("afterprint",restore);
  window.print();
  setTimeout(restore,1000);
}
function TenderPrintModal({onClose,onPrint}){
  const [o,setO]=useState(tpLoad);
  function set(k,v){var n=Object.assign({},o);n[k]=v;setO(n);}
  function chip(on){return {borderRadius:16,background:on?"var(--ink)":"#fff",color:on?"#fff":"var(--ink-3)",borderColor:on?"var(--ink)":"#d9d5ca"};}
  return <div className="overlay" onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:480}}>
      <div className="modal-hdr">
        <div className="modal-title">🖨️ Print packages</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
      </div>
      <div className="modal-body">
        <div style={{fontSize:12,color:"#6f6b62",marginBottom:10}}>The Package columns always print. The table is scaled to the page width; the current filters apply.</div>
        {TP_SECTIONS.map(function(s,i){
          return <React.Fragment key={s.k}>
            {i===4&&<div style={{borderTop:"1px solid var(--rule-2)",margin:"8px 0"}}/>}
            <label style={{display:"flex",alignItems:"baseline",gap:8,padding:"4px 0",cursor:"pointer",fontSize:13}}>
              <input type="checkbox" checked={!!o[s.k]} onChange={function(e){set(s.k,e.target.checked);}} style={{width:"auto",margin:0}}/>
              <span style={{fontWeight:600}}>{s.label}</span><span style={{fontSize:11,color:"#9b968b"}}>{s.hint}</span>
            </label>
          </React.Fragment>;
        })}
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#9b968b",width:50}}>Page</span>
          {["A4","A3"].map(function(z){return <button key={z} className="btn btn-sm" style={chip(o.size===z)} onClick={function(){set("size",z);}}>{z}</button>;})}
          <span style={{width:8}}/>
          {[["landscape","Landscape"],["portrait","Portrait"]].map(function(x){return <button key={x[0]} className="btn btn-sm" style={chip(o.orient===x[0])} onClick={function(){set("orient",x[0]);}}>{x[1]}</button>;})}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={function(){onPrint(o);}}>🖨️ Print</button>
      </div>
    </div>
  </div>;
}

function TenderGapsModal({tenders,saveTenders,packages,people,onOpenTender,onClose}){
  const [drafts,setDrafts]=useState({});
  const [fieldF,setFieldF]=useState("");
  const [pkgF,setPkgF]=useState("");
  var ro=isReadOnly();
  // The list is frozen when the window opens: a line does not vanish while it is being typed in.
  const [rows]=useState(function(){
    return(tenders||[]).map(function(td){return{td:td,gaps:tenderGaps(td)};}).filter(function(r){return r.gaps.length;})
      .sort(function(a,b){return(a.td.package||"").localeCompare(b.td.package||"")||(a.td.title||"").localeCompare(b.td.title||"");});
  });
  var shown=rows.filter(function(r){return(!fieldF||r.gaps.indexOf(fieldF)>=0)&&(!pkgF||(r.td.package||"(no package)")===pkgF);});
  var cols=TENDER_GAP_FIELDS.filter(function(f){return(fieldF?f.k===fieldF:shown.some(function(r){return r.gaps.indexOf(f.k)>=0;}));});
  var countBy={};rows.forEach(function(r){r.gaps.forEach(function(k){countBy[k]=(countBy[k]||0)+1;});});
  var totalGaps=rows.reduce(function(s,r){return s+r.gaps.length;},0);
  var nChanged=Object.keys(drafts).reduce(function(s,id){return s+Object.keys(drafts[id]).filter(function(k){return !_gapBlank(drafts[id][k]);}).length;},0);
  var pkgs=[...new Set(rows.map(function(r){return r.td.package||"(no package)";}))].sort();
  function setDraft(id,k,v){
    var d=Object.assign({},drafts);d[id]=Object.assign({},d[id]||{});d[id][k]=v;setDrafts(d);
  }
  function save(){
    if(blockIfReadOnly())return;
    var next=(tenders||[]).map(function(t){
      var dr=drafts[t.id];if(!dr)return t;
      var u=Object.assign({},t),steps=Object.assign({},t.steps||{}),touched=false;
      Object.keys(dr).forEach(function(k){
        var v=dr[k];if(_gapBlank(v))return;
        touched=true;
        if(k.indexOf("step:")===0)steps[k.slice(5)]=v;
        else if(k==="proposed")u.accAmountSubcontract=v;
        else u[k]=v;
      });
      if(!touched)return t;
      u.steps=steps;
      return u;
    });
    saveTenders(next);
    onClose();
  }
  function close(){if(nChanged&&!confirm("Leave without saving "+nChanged+" value"+(nChanged>1?"s":"")+"?"))return;onClose();}
  var inp={width:"100%",minWidth:0,boxSizing:"border-box",fontSize:11,padding:"3px 5px",border:"1.5px solid #f48fb1",borderRadius:5,background:"#fff8f9",fontFamily:"inherit"};
  function editor(td,f){
    var v=(drafts[td.id]||{})[f.k];
    var st=Object.assign({},inp,_gapBlank(v)?{}:{borderColor:"#81c784",background:"#f2f9f3"});
    if(f.kind==="open")return <button className="btn btn-sm" style={{fontSize:10,height:24}} onClick={function(){onOpenTender(td);}} title={f.tip}>Open ↗</button>;
    if(f.kind==="package")return <select disabled={ro} value={v||""} style={st} onChange={function(e){setDraft(td.id,f.k,e.target.value);}}><option value="">—</option>{(packages||[]).map(function(p){return <option key={p}>{p}</option>;})}</select>;
    if(f.kind==="person")return <select disabled={ro} value={v||""} style={st} onChange={function(e){setDraft(td.id,f.k,e.target.value);}}><option value="">—</option>{(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}</select>;
    if(f.kind==="step"){
      var key=f.k.slice(5),def=TENDER_STEPS.find(function(s){return s.key===key;});
      var opts=key==="acc"?flowPresubOpts(def.opts):def.opts;
      return <select disabled={ro} value={v||""} style={st} onChange={function(e){setDraft(td.id,f.k,e.target.value==="—"?"":e.target.value);}}>{opts.map(function(o){return <option key={o} value={o==="—"?"":o}>{o}</option>;})}</select>;
    }
    return <input disabled={ro} type={f.kind==="number"?"number":f.kind==="date"?"date":"text"} value={v||""} placeholder="missing" style={Object.assign({},st,f.kind==="number"?{textAlign:"right"}:{})}
      onChange={function(e){setDraft(td.id,f.k,e.target.value);}}/>;
  }
  return <div className="overlay"><div className="modal" style={{maxWidth:"min(1500px,96vw)"}}>
    <div className="modal-hdr"><div>
        <div className="modal-title">🧩 Missing information</div>
        <div style={{fontSize:12,color:"#888",marginTop:2}}>{totalGaps} blank{totalGaps===1?"":"s"} in {rows.length} tender{rows.length===1?"":"s"} (cancelled tenders left out). Fill what you know, then Save once.</div>
      </div>
      <button onClick={close} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      {!rows.length?<div className="empty"><div className="empty-ico">✅</div><div className="empty-txt">Nothing missing: the table is complete.</div></div>:<>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
        <button className={"fchip"+(fieldF===""?" on":"")} onClick={function(){setFieldF("");}}>All fields</button>
        {TENDER_GAP_FIELDS.filter(function(f){return countBy[f.k];}).map(function(f){
          return <button key={f.k} className={"fchip"+(fieldF===f.k?" on":"")} title={f.tip||""} onClick={function(){setFieldF(fieldF===f.k?"":f.k);}}>{f.label} <b style={{color:"#c62828",marginLeft:3}}>{countBy[f.k]}</b></button>;
        })}
        {pkgs.length>1&&<select value={pkgF} onChange={function(e){setPkgF(e.target.value);}} style={{marginLeft:"auto",fontSize:12,width:"auto",minWidth:160}}><option value="">All packages</option>{pkgs.map(function(p){return <option key={p}>{p}</option>;})}</select>}
      </div>
      <div style={{overflowX:"auto"}}><table className="tbl tbl-tenders">
        <thead><tr><th style={{minWidth:200}}>Tender</th>{cols.map(function(f){return <th key={f.k} title={f.tip||""} style={{minWidth:f.kind==="person"||f.kind==="package"||f.kind==="step"?130:f.kind==="open"?80:105}}>{f.label}</th>;})}</tr></thead>
        <tbody>{shown.map(function(r,i){
          var td=r.td;
          return <tr key={td.id} style={{background:i%2?"#f7f5ef":"#fff"}}>
            <td style={{verticalAlign:"middle"}}><div style={{fontWeight:700,cursor:"pointer"}} onClick={function(){onOpenTender(td);}} title="Open the tender sheet">{td.title||"(no title)"}</div>
              <div style={{fontSize:10,color:"#888"}}>{td.package||"no package"} · {r.gaps.length} missing</div></td>
            {cols.map(function(f){
              return <td key={f.k} style={{verticalAlign:"middle"}}>{r.gaps.indexOf(f.k)>=0?editor(td,f):<span style={{color:"#c8e6c9"}}>✓</span>}</td>;
            })}
          </tr>;
        })}</tbody>
      </table></div>
      <div style={{fontSize:11,color:"#888",marginTop:8}}>Red = missing, green = filled here, ✓ = already known. “Awarded to” needs the tender's Awards panel: Open ↗. Proposed and Instruction are only asked once the ACC is approved / the contract is signed.</div>
      </>}
    </div>
    <div className="modal-footer">
      <span style={{marginRight:"auto",fontSize:12,color:nChanged?"#2e7d32":"#888",alignSelf:"center"}}>{nChanged?nChanged+" value"+(nChanged>1?"s":"")+" to save":"Nothing typed yet"}</span>
      <button className="btn" onClick={close}>Cancel</button>
      {!ro&&<button className="btn btn-pri" disabled={!nChanged} onClick={save}>✓ Save</button>}
    </div>
  </div></div>;
}
