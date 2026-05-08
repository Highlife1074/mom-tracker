<div style={{marginBottom:4,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>{syncDot}<span style={{fontSize:7,color:"#888",textAlign:"center"}}>{syncStatus==="syncing"?"saving...":syncStatus==="ok"?"saved":"err"}</span></div>
  {NAV.map(n=><button key={n.id} className={"navbtn"+(view===n.id?" on":"")} onClick={()=>setView(n.id)} title={n.label}>
    <span style={{fontSize:20}}>{n.icon}</span>
    <span className="lbl">{n.label}</span>
  </button>)}
  <div className="nav-sep"/>
</nav>

<div className="main-area">
  <div className="content">
    {view==="actions"&&<ActionsView tasks={tasks} setTasks={setTasks} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors} trackers={trackers} saveT={saveT} tagrules={tagrules} pkgrules={pkgrules}/>}
    {view==="trackers"&&<TrackersView trackers={trackers} setTrackers={setTrackers} saveX={saveX} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors} tagrules={tagrules} pkgrules={pkgrules}/>}
    {view==="tenders"&&<TendersView tenders={tenders} saveTenders={saveTenders} packages={packages} people={people} tasks={tasks} saveTasks={saveT} contractors={contractors} pkgOwners={pkgOwners} jumpTender={jumpTender} clearJumpTender={function(){setJumpTender(null);}} jumpFrom={jumpFrom} clearJumpFrom={function(){setJumpFrom(null);}} onBack={jumpFrom?function(){setView(jumpFrom);setJumpTender(null);setJumpFrom(null);}:null}/>}
    {view==="contractors"&&<ContractorsView contractors={contractors} saveContractors={saveContractors} packages={packages} people={people} tasks={tasks} tenders={tenders} apiKey={apiKey} correspondences={correspondences} saveCorrespondences={saveCorrespondences} saveT={saveT} onNavTender={navToTender}/>}
    {view==="contracts"&&<ContractsView contractors={contractors} saveContractors={saveContractors} tenders={tenders} packages={packages} tasks={tasks} saveTasks={saveT}/>}
    {view==="awn"&&<AwnView awns={awns} saveAwns={saveAwns} people={people}/>}
    {view==="weekly"&&<WeeklyView tasks={tasks} trackers={trackers} people={people} tags={tags} tagrules={tagrules} pkgrules={pkgrules} packages={packages} tenders={tenders} contractors={contractors}/>}
    {view==="documents"&&<DocumentsView tasks={tasks} tenders={tenders} contractors={contractors} packages={packages} people={people} saveTasks={saveT}/> }
{view==="dashboard"&&<DashboardView tasks={tasks} trackers={trackers} people={people} tenders={tenders} contractors={contractors} packages={packages} onJumpOwner={function(name){setJumpOwner(name);setView("global");}} onNavTender={navToTender}/>}
{view==="global"&&<GlobalView tasks={tasks} trackers={trackers} tenders={tenders} contractors={contractors} people={people} packages={packages} tags={tags} saveTasks={saveT} saveTrackers={saveX} tagrules={tagrules} pkgrules={pkgrules} jumpOwner={jumpOwner} clearJump={function(){setJumpOwner(null);}} onNavTender={navToTender}/>}
    {view==="settings"&&<SettingsView tags={tags} saveTags={saveTags} people={people} savePeople={savePeople} packages={packages} savePackages={savePackages} tagrules={tagrules} saveTagrules={saveTagrules} pkgrules={pkgrules} savePkgrules={savePkgrules} apiKey={apiKey} saveApiKey={saveApiKey} improvements={improvements} saveImprovements={saveImprovements} pkgOwners={pkgOwners} savePkgOwners={savePkgOwners} userPrefs={userPrefs} saveUserPrefs={saveUserPrefs} allData={{tasks,trackers,tenders,contractors,people,packages,tags,tagrules,pkgrules,improvements,correspondences,awns,pkgOwners}} onImport={function(d){if(d.tasks)saveT(d.tasks);if(d.trackers)saveX(d.trackers);if(d.tenders)saveTenders(d.tenders);if(d.contractors)saveContractors(d.contractors);if(d.people)savePeople(d.people);if(d.packages)savePackages(d.packages);if(d.tags)saveTags(d.tags);}}/>}
  </div>

  <aside className={"rsidebar "+(sidebarOpen?"open":"closed")}>
    <div style={{display:"flex",alignItems:"center",justifyContent:sidebarOpen?"flex-end":"center",padding:"8px 8px 0",flexShrink:0}}>
      <button onClick={function(){setSidebarOpen(!sidebarOpen);}} title={sidebarOpen?"Collapse sidebar":"Expand sidebar"}
        style={{background:"none",border:"1px solid #e8e6df",borderRadius:6,cursor:"pointer",padding:"3px 6px",fontSize:12,color:"#888",lineHeight:1}}>
        {sidebarOpen?"›":"‹"}
      </button>
    </div>
    {sidebarOpen&&<QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} trackers={trackers} tags={tags} onAdd={addTask} improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/>}
  </aside>
<div className="no-print"><ImprovementBox improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/></div>
<div className="no-print" style={{position:"fixed",bottom:16,right:360,zIndex:490}}>
  <button onClick={function(){setShowWeeklyPopup(true);}} title="Weekly Actions" style={{width:36,height:36,borderRadius:"50%",background:"#3949ab",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>📋</button>
</div>
{newTasksPopup&&<NewTasksPopup tasks={newTasksPopup} tenders={tenders} contractors={contractors} onClose={function(){setNewTasksPopup(null);}}/> }
{showWeeklyPopup&&<WeeklyPopup tasks={tasks} trackers={trackers} people={people} tags={tags} tagrules={tagrules} pkgrules={pkgrules} tenders={tenders} contractors={contractors} saveT={saveT} saveX={saveX} onClose={function(){setShowWeeklyPopup(false);}}/>}
<div className="mobile-qa-btn" onClick={function(){setMobileQAOpen(true);}} title="Quick Add Task" style={{display:"none",position:"fixed",bottom:62,right:16,zIndex:490,width:44,height:44,borderRadius:"50%",background:"#c9a84c",boxShadow:"0 2px 8px rgba(0,0,0,.2)",alignItems:"center",justifyContent:"center",fontSize:22,cursor:"pointer",color:"#1c1c1e"}}>+</div>
{mobileQAOpen&&<div className="overlay" style={{zIndex:600}} onClick={function(e){if(e.target===e.currentTarget)setMobileQAOpen(false);}}><div style={{background:"#fff",borderRadius:"16px 16px 0 0",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",position:"absolute",bottom:0}}><QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} trackers={trackers} tags={tags} onAdd={function(t){addTask(t);setMobileQAOpen(false);}} improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/></div></div>}
<div className="no-print" style={{position:"fixed",bottom:16,right:318,zIndex:500}}>
  <button onClick={function(){setPdfGlobal({open:true});}} title="Import certification from PDF"
    style={{width:36,height:36,borderRadius:"50%",background:"#1a73e8",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",transition:"all .15s"}}>
    📄
  </button>
</div>
{pdfGlobal&&pdfGlobal.open&&<GlobalPdfModal contractors={contractors} saveContractors={saveContractors} onClose={function(){setPdfGlobal(null);}}/>}
</div>
