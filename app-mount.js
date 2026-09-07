// ===========================================================================
// app-mount.js — Mounts the app. MUST load last: it renders App, which needs every view defined.
//
// index.html fetches these files and concatenates them in this fixed order:
//   core -> tenders -> schedule -> zone -> reports -> mount
// They share one scope, exactly as when everything lived in app.js.
// Function declarations hoist across the whole bundle, so the order only
// matters for the mount, which must come last.
// ===========================================================================

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ErrorBoundary,null,React.createElement(App)));

