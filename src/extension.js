const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

function activate(context) {
  console.log('GeoJSON Viewer activated');

  // Command to open the viewer
  const openCommand = vscode.commands.registerCommand('geojsonViewer.open', async (uri) => {
    // If no URI passed (e.g., from command palette), use active editor
    if (!uri) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active file to open.');
        return;
      }
      uri = editor.document.uri;
    }

    // Read the file content
    let content;
    try {
      content = fs.readFileSync(uri.fsPath, 'utf-8');
    } catch (err) {
      vscode.window.showErrorMessage(`Could not read file: ${err.message}`);
      return;
    }

    // Validate it's GeoJSON
    let geojson;
    try {
      geojson = JSON.parse(content);
      if (!geojson.type) throw new Error('Missing "type" field');
    } catch (err) {
      vscode.window.showErrorMessage(`Invalid GeoJSON: ${err.message}`);
      return;
    }

    // Open the webview panel
    openGeoJsonPanel(context, uri, geojson);
  });

  context.subscriptions.push(openCommand);

  // Auto-open when a .geojson file is opened
  const onOpen = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (isGeoJson(doc)) {
      vscode.commands.executeCommand('geojsonViewer.open', doc.uri);
    }
  });
  context.subscriptions.push(onOpen);


  // Handle files already open when extension activates (e.g. after F5 reload)
  setTimeout(function() {
    const active = vscode.window.activeTextEditor;
    if (active && isGeoJson(active.document)) {
      vscode.commands.executeCommand('geojsonViewer.open', active.document.uri);
      return;
    }
    for (const doc of vscode.workspace.textDocuments) {
      if (isGeoJson(doc)) {
        vscode.commands.executeCommand('geojsonViewer.open', doc.uri);
        break;
      }
    }
  }, 500);
}

function isGeoJson(doc) {
  return doc.fileName.endsWith('.geojson') ||
    (doc.fileName.endsWith('.json') && doc.getText().includes('FeatureCollection'));
}

// Track open panels per file path
const openPanels = {};

function openGeoJsonPanel(context, uri, geojson) {
  const fileName = path.basename(uri.fsPath);
  const key = uri.fsPath;

  // If a panel for this file already exists, just reveal it — don't open a new one
  if (openPanels[key]) {
    openPanels[key].reveal(vscode.ViewColumn.Beside);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'geojsonViewer',
    `GeoJSON: ${fileName}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  panel.webview.html = getWebviewContent(geojson, fileName);

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage((message) => {
    if (message.command === 'showError') {
      vscode.window.showErrorMessage(message.text);
    }
  });

  // ── File watcher: reload when the .geojson file changes on disk ──
  const watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);

  let debounceTimer = null;

  function reloadFile() {
    // Debounce rapid saves (e.g. auto-save bursts)
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf-8');
        const updated = JSON.parse(content);
        // Push new data into the webview — no full reload, just a message
        panel.webview.postMessage({ command: 'update', geojson: updated });
      } catch (err) {
        // Don't spam errors on every keystroke during editing
        panel.webview.postMessage({ command: 'parseError', message: err.message });
      }
    }, 300);
  }

  watcher.onDidChange(reloadFile);  // saved from external editor
  watcher.onDidCreate(reloadFile);  // file recreated

  // Also watch VS Code's own document saves
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.fsPath === uri.fsPath) reloadFile();
  });

  // Register panel so we can reuse it
  openPanels[uri.fsPath] = panel;

  // Clean up watcher when panel is closed
  panel.onDidDispose(() => {
    delete openPanels[uri.fsPath];
    watcher.dispose();
    onSave.dispose();
    clearTimeout(debounceTimer);
  });
}

function getWebviewContent(geojson, fileName) {
  const geojsonStr = JSON.stringify(geojson);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>GeoJSON Viewer</title>

  <!-- Leaflet Map -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Syne:wght@400;600;800&display=swap');

    :root {
      --bg: #0f1117;
      --surface: #181c27;
      --surface2: #1e2333;
      --border: #2a3050;
      --accent: #00e5a0;
      --accent2: #5b8fff;
      --text: #e2e8f0;
      --muted: #64748b;
      --danger: #ff6b6b;
      --warning: #ffd166;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Syne', sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .header-icon {
      width: 32px; height: 32px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }

    .header-title {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }

    .header-sub {
      font-size: 11px;
      color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
      margin-left: auto;
    }

    .badge {
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      background: rgba(0,229,160,0.12);
      color: var(--accent);
      border: 1px solid rgba(0,229,160,0.25);
    }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 4px;
      padding: 10px 20px 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .tab {
      padding: 8px 18px;
      border: none;
      background: transparent;
      color: var(--muted);
      font-family: 'Syne', sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 6px 6px 0 0;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    .tab:hover { color: var(--text); }

    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      background: rgba(0,229,160,0.05);
    }

    /* ── Main content area ── */
    .content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .pane {
      position: absolute;
      inset: 0;
      display: none;
      overflow: auto;
    }

    .pane.active { display: flex; flex-direction: column; }

    /* ── Map ── */
    #map {
      flex: 1;
      min-height: 0;
    }

    .map-legend {
      padding: 10px 20px;
      display: flex;
      gap: 20px;
      align-items: center;
      background: var(--surface2);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
      font-size: 12px;
      color: var(--muted);
    }

    .legend-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 5px;
    }

    /* ── Table ── */
    .table-toolbar {
      padding: 12px 20px;
      display: flex;
      gap: 10px;
      align-items: center;
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .search-box {
      flex: 1;
      max-width: 320px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px 14px;
      color: var(--text);
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-box:focus { border-color: var(--accent); }
    .search-box::placeholder { color: var(--muted); }

    .row-count {
      font-size: 12px;
      color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
    }

    .table-wrapper {
      flex: 1;
      overflow: auto;
      padding: 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
    }

    thead {
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th {
      background: var(--surface2);
      padding: 10px 16px;
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: var(--accent);
      border-bottom: 2px solid var(--border);
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      font-family: 'Syne', sans-serif;
    }

    th:hover { background: var(--surface); }

    th .sort-icon { margin-left: 4px; opacity: 0.4; }
    th.sorted .sort-icon { opacity: 1; }

    td {
      padding: 9px 16px;
      border-bottom: 1px solid rgba(42,48,80,0.5);
      color: var(--text);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    tr:hover td { background: rgba(0,229,160,0.04); }

    tr.highlight td { background: rgba(91,143,255,0.1); }

    .type-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }

    .type-Point { background: rgba(0,229,160,0.15); color: var(--accent); }
    .type-LineString, .type-MultiLineString { background: rgba(91,143,255,0.15); color: var(--accent2); }
    .type-Polygon, .type-MultiPolygon { background: rgba(255,107,107,0.15); color: var(--danger); }
    .type-MultiPoint { background: rgba(255,209,102,0.15); color: var(--warning); }

    /* ── Stats bar ── */
    .stats {
      display: flex;
      gap: 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .stat {
      flex: 1;
      padding: 10px 20px;
      border-right: 1px solid var(--border);
      text-align: center;
    }

    .stat:last-child { border-right: none; }

    .stat-value {
      font-size: 18px;
      font-weight: 800;
      color: var(--accent);
    }

    .stat-label {
      font-size: 10px;
      color: var(--muted);
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-top: 2px;
      font-family: 'Syne', sans-serif;
    }

    /* ── No data ── */
    .no-data {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: var(--muted);
      font-size: 13px;
      gap: 8px;
    }

    .no-data-icon { font-size: 32px; }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--muted); }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 20px; right: 20px;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
      z-index: 9999;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.success { background: rgba(0,229,160,0.15); color: var(--accent); border: 1px solid rgba(0,229,160,0.3); }
    .toast.error   { background: rgba(255,107,107,0.15); color: var(--danger); border: 1px solid rgba(255,107,107,0.3); }

    /* ── Live dot ── */
    .live-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 2s infinite;
      flex-shrink: 0;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  </style>
</head>
<body>

<div class="header">
  <div class="header-icon">🗺</div>
  <div class="header-title">GeoJSON Viewer</div>
  <span class="badge" id="type-badge">FeatureCollection</span>
  <div class="live-dot" title="Live — auto-refreshes on save"></div>
  <div class="header-sub" id="file-name">${fileName}</div>
</div>
<div class="toast" id="toast"></div>

<!-- Stats bar -->
<div class="stats" id="stats-bar"></div>

<!-- Tabs -->
<div class="tabs">
  <button class="tab active" onclick="switchTab('map')">🗺 Map</button>
  <button class="tab" onclick="switchTab('table')">📋 Table</button>
</div>

<!-- Content -->
<div class="content">

  <!-- Map Pane -->
  <div class="pane active" id="pane-map">
    <div id="map"></div>
    <div class="map-legend" id="map-legend"></div>
  </div>

  <!-- Table Pane -->
  <div class="pane" id="pane-table">
    <div class="table-toolbar">
      <input class="search-box" id="search" type="text" placeholder="Search properties…" oninput="filterTable()"/>
      <div class="row-count" id="row-count"></div>
    </div>
    <div class="table-wrapper">
      <table id="feature-table">
        <thead id="table-head"></thead>
        <tbody id="table-body"></tbody>
      </table>
      <div class="no-data" id="no-data" style="display:none">
        <div class="no-data-icon">🔍</div>
        No matching features
      </div>
    </div>
  </div>

</div>

<script>
  const geojson = ${geojsonStr};

  // ── Tab switching ──────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t, i) => {
      t.classList.toggle('active', ['map','table'][i] === name);
    });
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    document.getElementById('pane-' + name).classList.add('active');
    if (name === 'map') setTimeout(() => map.invalidateSize(), 50);
  }

  // ── Normalize to features ──────────────────────────
  let features = [];
  if (geojson.type === 'FeatureCollection') {
    features = geojson.features || [];
  } else if (geojson.type === 'Feature') {
    features = [geojson];
  } else if (geojson.geometry) {
    features = [{ type: 'Feature', geometry: geojson, properties: {} }];
  }

  // ── Stats ──────────────────────────────────────────
  const types = {};
  features.forEach(f => {
    const t = f.geometry?.type || 'Unknown';
    types[t] = (types[t] || 0) + 1;
  });

  const statsBar = document.getElementById('stats-bar');
  statsBar.innerHTML = \`
    <div class="stat">
      <div class="stat-value">\${features.length}</div>
      <div class="stat-label">Features</div>
    </div>
    \${Object.entries(types).map(([t, c]) => \`
      <div class="stat">
        <div class="stat-value">\${c}</div>
        <div class="stat-label">\${t}</div>
      </div>
    \`).join('')}
  \`;

  document.getElementById('type-badge').textContent = geojson.type;

  // ── Leaflet Map ────────────────────────────────────
  const map = L.map('map', { preferCanvas: true }).setView([20, 0], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20
  }).addTo(map);

  const colorMap = {
    Point: '#00e5a0',
    MultiPoint: '#ffd166',
    LineString: '#5b8fff',
    MultiLineString: '#5b8fff',
    Polygon: '#ff6b6b',
    MultiPolygon: '#ff6b6b',
  };

  function styleFor(type) {
    const c = colorMap[type] || '#aaa';
    return { color: c, fillColor: c, weight: 2, opacity: 0.9, fillOpacity: 0.25 };
  }

  function pointToCircle(_, latlng) {
    return L.circleMarker(latlng, { radius: 7, ...styleFor('Point') });
  }

  let highlightedLayer = null;
  const layerMap = {};

  const geoLayer = L.geoJSON(geojson, {
    style: (f) => styleFor(f.geometry?.type),
    pointToLayer: pointToCircle,
    onEachFeature: (feature, layer) => {
      const idx = features.indexOf(feature);
      if (idx !== -1) layerMap[idx] = layer;

      const props = feature.properties || {};
      const rows = Object.entries(props).map(([k, v]) =>
        \`<tr><td style="color:#64748b;padding-right:10px">\${k}</td><td>\${v ?? '<i>null</i>'}</td></tr>\`
      ).join('');

      const popupContent = \`
        <div style="font-family:'JetBrains Mono',monospace;font-size:12px;max-width:260px">
          <div style="font-weight:700;margin-bottom:8px;font-family:'Syne',sans-serif;color:#00e5a0">
            \${feature.geometry?.type || 'Feature'}
          </div>
          <table>\${rows || '<tr><td style="color:#64748b">No properties</td></tr>'}</table>
        </div>
      \`;

      layer.bindPopup(popupContent);
    }
  }).addTo(map);

  // Fit map to data
  try {
    const bounds = geoLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  } catch(e) {}

  // Legend
  const legend = document.getElementById('map-legend');
  legend.innerHTML = Object.entries(colorMap)
    .filter(([t]) => types[t])
    .map(([t, c]) => \`<span><span class="legend-dot" style="background:\${c}"></span>\${t} (\${types[t]})</span>\`)
    .join('');

  // ── Table ──────────────────────────────────────────
  const allKeys = [...new Set(features.flatMap(f => Object.keys(f.properties || {})))];
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');
  let sortKey = null, sortDir = 1;

  function buildTable(data) {
    thead.innerHTML = \`<tr>
      <th onclick="sortTable('#')">#<span class="sort-icon">↕</span></th>
      <th onclick="sortTable('__type')">Type<span class="sort-icon">↕</span></th>
      \${allKeys.map(k => \`<th onclick="sortTable('\${k}')">\${k}<span class="sort-icon">↕</span></th>\`).join('')}
    </tr>\`;

    tbody.innerHTML = data.map((f, i) => {
      const idx = features.indexOf(f);
      const t = f.geometry?.type || 'Unknown';
      const cells = allKeys.map(k => {
        const v = f.properties?.[k];
        return \`<td title="\${v ?? ''}">\${v ?? '<span style="color:#2a3050">—</span>'}</td>\`;
      });
      return \`<tr id="row-\${idx}" onclick="highlightFeature(\${idx})" style="cursor:pointer">
        <td style="color:#64748b">\${idx + 1}</td>
        <td><span class="type-badge type-\${t}">\${t}</span></td>
        \${cells.join('')}
      </tr>\`;
    }).join('');

    document.getElementById('row-count').textContent = \`\${data.length} / \${features.length} features\`;
    document.getElementById('no-data').style.display = data.length ? 'none' : 'flex';
    document.getElementById('feature-table').style.display = data.length ? '' : 'none';
  }

  function sortTable(key) {
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }

    document.querySelectorAll('th').forEach(th => th.classList.remove('sorted'));

    const sorted = [...filteredFeatures].sort((a, b) => {
      let va = key === '__type' ? a.geometry?.type
             : key === '#' ? features.indexOf(a)
             : a.properties?.[key];
      let vb = key === '__type' ? b.geometry?.type
             : key === '#' ? features.indexOf(b)
             : b.properties?.[key];
      if (va == null) return 1; if (vb == null) return -1;
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });

    buildTable(sorted);
  }

  let filteredFeatures = [...features];

  function filterTable() {
    const q = document.getElementById('search').value.toLowerCase();
    filteredFeatures = features.filter(f => {
      if (!q) return true;
      const vals = Object.values(f.properties || {}).join(' ').toLowerCase();
      const type = (f.geometry?.type || '').toLowerCase();
      return vals.includes(q) || type.includes(q);
    });
    buildTable(filteredFeatures);
  }

  function highlightFeature(idx) {
    // Highlight row
    document.querySelectorAll('tr.highlight').forEach(r => r.classList.remove('highlight'));
    document.getElementById('row-' + idx)?.classList.add('highlight');

    // Switch to map + open popup
    switchTab('map');
    const layer = layerMap[idx];
    if (layer) {
      map.invalidateSize();
      setTimeout(() => {
        try {
          if (layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [40, 40] });
          else if (layer.getLatLng) map.setView(layer.getLatLng(), Math.max(map.getZoom(), 12));
          layer.openPopup();
        } catch(e) {}
      }, 80);
    }
  }


  buildTable(features);

  // ── Toast helper ───────────────────────────────────
  let toastTimer;
  function showToast(msg, type) {
    type = type || 'success';
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + type + ' show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2500);
  }

  // ── Live reload: listen for updates from extension ─
  const vscodeApi = acquireVsCodeApi();
  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.command === 'update') {
      try { renderAll(msg.geojson); showToast('Refreshed', 'success'); }
      catch(e) { showToast('Render error: ' + e.message, 'error'); }
    }
    if (msg.command === 'parseError') {
      showToast('Invalid JSON — fix and save again', 'error');
    }
  });

  // ── Full re-render without page reload ─────────────
  function renderAll(newGeojson) {
    let newFeatures = [];
    if (newGeojson.type === 'FeatureCollection') newFeatures = newGeojson.features || [];
    else if (newGeojson.type === 'Feature') newFeatures = [newGeojson];
    else if (newGeojson.geometry) newFeatures = [{ type: 'Feature', geometry: newGeojson, properties: {} }];

    features.length = 0;
    features.push.apply(features, newFeatures);
    filteredFeatures = features.slice();

    document.getElementById('type-badge').textContent = newGeojson.type;

    const newTypes = {};
    newFeatures.forEach(function(f) {
      const t = (f.geometry && f.geometry.type) || 'Unknown';
      newTypes[t] = (newTypes[t] || 0) + 1;
    });

    statsBar.innerHTML = '<div class="stat"><div class="stat-value">' + newFeatures.length + '</div><div class="stat-label">Features</div></div>' +
      Object.entries(newTypes).map(function(e) {
        return '<div class="stat"><div class="stat-value">' + e[1] + '</div><div class="stat-label">' + e[0] + '</div></div>';
      }).join('');

    geoLayer.clearLayers();
    Object.keys(layerMap).forEach(function(k) { delete layerMap[k]; });

    newFeatures.forEach(function(feature) {
      const idx = newFeatures.indexOf(feature);
      let layer;
      const geomType = feature.geometry && feature.geometry.type;
      if (geomType === 'Point' || geomType === 'MultiPoint') {
        const coords = feature.geometry.coordinates;
        const latlng = geomType === 'Point' ? L.latLng(coords[1], coords[0]) : L.latLng(coords[0][1], coords[0][0]);
        layer = L.circleMarker(latlng, Object.assign({ radius: 7 }, styleFor('Point')));
      } else {
        layer = L.geoJSON(feature, { style: function() { return styleFor(geomType); } });
      }
      if (idx !== -1) layerMap[idx] = layer;
      const props = feature.properties || {};
      const rows = Object.entries(props).map(function(kv) {
        return '<tr><td style="color:#64748b;padding-right:10px">' + kv[0] + '</td><td>' + (kv[1] != null ? kv[1] : '<i>null</i>') + '</td></tr>';
      }).join('');
      layer.bindPopup('<div style="font-family:JetBrains Mono,monospace;font-size:12px;max-width:260px"><div style="font-weight:700;margin-bottom:8px;color:#00e5a0">' + (geomType || 'Feature') + '</div><table>' + (rows || '<tr><td style="color:#64748b">No properties</td></tr>') + '</table></div>');
      layer.addTo(geoLayer);
    });

    try { const b = geoLayer.getBounds(); if (b.isValid()) map.fitBounds(b, { padding: [20, 20] }); } catch(e) {}

    legend.innerHTML = Object.entries(colorMap)
      .filter(function(e) { return newTypes[e[0]]; })
      .map(function(e) { return '<span><span class="legend-dot" style="background:' + e[1] + '"></span>' + e[0] + ' (' + newTypes[e[0]] + ')</span>'; })
      .join('');

    buildTable(newFeatures);
  }

</script>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
