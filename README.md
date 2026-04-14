# GeoJSON Viewer — VS Code Extension

View any `.geojson` file as an **interactive map + data table** — directly inside VS Code.

---

## Features

- 🗺 **Interactive Map** — powered by Leaflet + CartoDB dark tiles
- 📋 **Data Table** — all feature properties in a searchable, sortable table
- 🔗 **Click-to-link** — click a table row to jump to that feature on the map
- 🏷 **Geometry badges** — Point, Polygon, LineString, etc. color-coded
- 📊 **Stats bar** — feature counts by geometry type at a glance
- 🔍 **Search** — filter features by any property value
- ↕ **Sort** — click any column header to sort

---

## Installation

### Option A — Run from source (development)

1. **Install dependencies** (none required — pure JS, no npm install needed)
2. Open this folder in VS Code:
   ```
   code /path/to/geojson-viewer
   ```
3. Press **F5** → a new VS Code window opens with the extension loaded
4. Open any `.geojson` file → the viewer opens automatically beside it

### Option B — Install as VSIX (share with others)

1. Install the packaging tool:
   ```bash
   npm install -g @vscode/vsce
   ```
2. Package it:
   ```bash
   cd geojson-viewer
   vsce package
   ```
3. This creates a `geojson-viewer-0.0.1.vsix` file
4. Install it in VS Code:
   - Open VS Code → Extensions sidebar → `...` menu → **Install from VSIX…**

---

## Usage

| Action | Result |
|---|---|
| Open a `.geojson` file | Viewer opens automatically beside it |
| Click **Map** tab | See all features on an interactive dark map |
| Click **Table** tab | Browse all feature properties |
| Click a table row | Jumps to that feature on the map + opens popup |
| Type in search box | Filters features by any property value |
| Click a column header | Sorts the table by that column |

---

## How It Works

The extension uses VS Code's **Webview API** to render an HTML panel beside your editor. The panel contains:

- **Leaflet.js** for the map (loaded from CDN)
- **CartoDB dark tiles** as the basemap
- Vanilla JS table with search + sort

No build step, no webpack — just plain JS.

---

## File Structure

```
geojson-viewer/
├── src/
│   └── extension.js      ← main extension logic + webview HTML
├── package.json           ← VS Code extension manifest
└── README.md
```

---

## Supported GeoJSON Types

- `FeatureCollection` ✅
- `Feature` ✅
- Bare geometry objects (`Point`, `Polygon`, etc.) ✅
