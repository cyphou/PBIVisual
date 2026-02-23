# Production with Perforations and Interventions

> **Power BI Custom Visual** for oil & gas well production analysis.
> Combines gas production, water cut, perforation depths, and intervention events
> in a single multi-axis time-series chart.

---

## Table of Contents

1. [Overview](#overview)
2. [Chart Anatomy](#chart-anatomy)
3. [Data Fields (Data Roles)](#data-fields-data-roles)
4. [Architecture & File Structure](#architecture--file-structure)
5. [Building & Installing](#building--installing)
6. [Using the Visual in Power BI](#using-the-visual-in-power-bi)
7. [Formatting Options](#formatting-options)
8. [Data Model & Examples](#data-model--examples)
9. [How It Works (Technical Deep Dive)](#how-it-works-technical-deep-dive)
10. [Troubleshooting](#troubleshooting)
11. [Contributing](#contributing)
12. [License](#license)

---

## Overview

This custom visual is designed for **upstream oil & gas production engineers** who
need to view well production history together with completion and intervention data.
It renders:

| Layer | Visual Element | Description |
|-------|---------------|-------------|
| Qgas | **Filled area chart** (orange) | Gas production rate over time |
| WCT | **Overlay line** (dark) | Water cut fraction (0–1) |
| Perforations | **Well-bore box markers** (green flanges + gray body) | Depth intervals where perforations exist, placed at the date they occurred |
| Interventions | **Circles / squares** (color-coded) | Discrete well events overlaid on the timeline |

All layers share the same **X-axis (dates)** but use **three independent Y-axes**:

```
 Left Y-axis             Chart Area                  Right Y-axes
┌────────────┐ ┌─────────────────────────────┐ ┌────────────────────┐
│ Perforations│ │                             │ │ Qgas (1000 m3/d)   │
│   (ft)      │ │   area + line + markers     │ │                    │
│  (inverted) │ │                             │ │ WCT (Fraction)     │
└────────────┘ └─────────────────────────────┘ └────────────────────┘
                          X-axis (Date)
```

---

## Chart Anatomy

### 1. Qgas Area Chart
- Draws a filled area from the baseline (0) up to the gas production rate.
- Uses `d3.curveMonotoneX` for smooth interpolation.
- Color is user-configurable (default: sandy orange `#F4A460`).

### 2. WCT Line Chart
- Renders as a line on top of the area chart.
- Mapped to its own right Y-axis so the 0–1 fraction scale doesn't distort the Qgas axis.
- Color is user-configurable (default: dark slate `#2F4F4F`).

### 3. Perforation Box Markers
- Each marker represents a **perforation interval** with a top depth and bottom depth.
- Rendered as a classic wellbore symbol:
  - **Wide green horizontal flanges** at the top and bottom of the interval
  - **Narrow gray vertical body** connecting them
- **X position** is determined by the `Date` field.
- **Y position & height** are determined by `Perf Top Depth` and `Perf Bottom Depth` on the left Y-axis.
- The left Y-axis is **inverted** (shallower depths at top, deeper at bottom) to match drilling conventions.

### 4. Intervention Markers
- Discrete events positioned on the timeline at their date.
- Three types identified by the `Intervention Type` field value:

| Value | Shape | Color (default) | Description |
|-------|-------|-----------------|-------------|
| `1` | Circle | Orange-brown `#D2691E` | Qgas-related event (positioned on Qgas Y-scale) |
| `2` | Circle | Royal blue `#4169E1` | WCT-related event (positioned on WCT Y-scale) |
| `3` | Square | Crimson `#DC143C` | Other event (positioned on Qgas Y-scale) |

### 5. Interactive Tooltip
- A crosshair (vertical dashed line) follows the mouse horizontally.
- Colored circles snap to the nearest Qgas and WCT data points.
- A floating tooltip box shows: Date, Qgas, WCT, Perforation interval, and Intervention type.
- The tooltip flips left/right to stay within chart bounds.

### 6. Legend
- Displayed below the title with the **latest non-null values** for Qgas and WCT.
- Format: `Qgas 1,546.17 (1000 m3/d)` — `WCT 0.06 (Fraction)`.

### 7. Date Range Labels
- Start date (bottom-left) and end date (bottom-right) of the data range.

---

## Data Fields (Data Roles)

Drag these from your Power BI data model onto the visual's field wells:

| Field Well | Role Kind | Required? | Description |
|------------|-----------|-----------|-------------|
| **Date** | Category (Grouping) | **Yes** | Date/time column defining the X-axis timeline. The visual sorts data by date ascending. |
| **Qgas (Gas Production)** | Measure | Recommended | Numeric gas production rate. Shown as the filled area chart. |
| **WCT (Water Cut)** | Measure | Recommended | Numeric water cut fraction (typically 0–1). Shown as the overlay line. |
| **Perf Top Depth** | Measure | Optional | Top depth of a perforation interval (e.g., in feet). Supply `null`/blank for dates with no perforation. |
| **Perf Bottom Depth** | Measure | Optional | Bottom depth of a perforation interval. Must be paired with Perf Top Depth. |
| **Intervention Type** | Measure | Optional | Integer: `1` = Qgas event, `2` = WCT event, `3` = Other. `0` or `null` = no event. |

> **Note:** The visual uses a `categorical` data view mapping with `top: 30000` data reduction.
> If your dataset has more than 30,000 date rows, consider aggregating at a coarser time grain.

---

## Architecture & File Structure

```
VisualPowerBI/
├── .vscode/
│   └── launch.json              # VS Code debug configuration (Chrome launch)
├── assets/
│   └── icon.png                 # Visual icon (32×32 placeholder)
├── dist/                        # ← BUILD OUTPUT (generated by `pbiviz package`)
│   └── productionPerfInterventionsVisual.1.0.0.0.pbiviz
├── src/
│   ├── settings.ts              # ChartSettings interface, defaults, and parser
│   └── visual.ts                # Main visual class (rendering, tooltips, axes)
├── style/
│   └── visual.less              # Stylesheet (hover effects, tooltips, axes)
├── capabilities.json            # Data roles, data view mappings, format objects
├── package.json                 # npm dependencies (D3 v7, PBI API v5.9)
├── pbiviz.json                  # Visual metadata (name, GUID, version, author)
├── tsconfig.json                # TypeScript compiler configuration
└── README.md                    # This file
```

### Key Source Files

#### `src/visual.ts` — Main Visual

| Section | Lines | Purpose |
|---------|-------|---------|
| **Imports & Interfaces** | Top | Power BI API types, D3, data interfaces (`ProductionDataPoint`, `PerforationInterval`, `InterventionEvent`) |
| **`constructor()`** | ~70 | Creates root SVG, initializes host services (tooltip, selection manager) |
| **`update()`** | ~85 | Entry point called by Power BI on every data/resize change; validates dataView, parses settings, delegates to rendering |
| **`extractData()`** | ~117 | Extracts categorical data, matches value columns to roles, builds typed data point array sorted by date |
| **`renderChart()`** | ~170 | Master render: computes scales, draws area/line/perforations/interventions/axes/grid/title/legend/tooltips |
| **`addTooltipOverlay()`** | ~600 | Creates invisible mouse-tracking rect, crosshair, snap-to-nearest logic, floating tooltip rendering |
| **`enumerateObjectInstances()`** | ~770 | Exposes formatting pane properties to Power BI |

#### `src/settings.ts` — Settings

| Export | Purpose |
|--------|---------|
| `ChartSettings` | TypeScript interface for all configurable properties |
| `defaultSettings` | Default values (colors, labels, units) |
| `parseSettings()` | Reads `dataView.metadata.objects` and returns a `ChartSettings` object |

#### `capabilities.json` — Capabilities

Defines 6 data roles, 1 categorical data view mapping, 10 formatting properties,
tooltip support, and highlighting support.

---

## Building & Installing

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | v18+ (LTS recommended) | JavaScript runtime |
| [powerbi-visuals-tools](https://www.npmjs.com/package/powerbi-visuals-tools) | v5+ | CLI for building Power BI visuals |

### Step-by-step

```bash
# 1. Install Power BI Visual Tools globally (one-time)
npm install -g powerbi-visuals-tools

# 2. Install project dependencies
cd VisualPowerBI
npm install

# 3. Build & package
pbiviz package
# Output: dist/productionPerfInterventionsVisual.1.0.0.0.pbiviz

# 4. (Optional) Start dev server for live-reload in Power BI Service
pbiviz start
```

### SSL Certificate (Development)

`pbiviz start` requires a trusted SSL certificate. The tool auto-generates one
using PowerShell. If `pwsh` is not available, you can manually create one:

```powershell
# Generate self-signed certificate (Windows PowerShell 5.1)
$cert = New-SelfSignedCertificate -DnsName "localhost" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(5)

$pwd = ConvertTo-SecureString -String "powerbi" -Force -AsPlainText

# Export to the folder pbiviz expects
$certDir = Join-Path $env:USERPROFILE "pbiviz-certs"
New-Item -ItemType Directory -Path $certDir -Force
Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
    -FilePath "$certDir\PowerBICustomVisualTest_public.pfx" -Password $pwd
Set-Content "$certDir\PowerBICustomVisualTestPass.txt" "powerbi" -NoNewline
```

---

## Using the Visual in Power BI

### Import

1. Run `pbiviz package`.
2. In **Power BI Desktop** → Visualizations pane → **…** → **Import a visual from a file**.
3. Select `dist/productionPerfInterventionsVisual.1.0.0.0.pbiviz`.
4. A new icon appears in the Visualizations pane.

### Configure

1. Click the visual icon to add it to your report.
2. Drag fields from your data model into the field wells:

   ```
   Date ──────────────► [Date]
   GasProductionRate ──► [Qgas (Gas Production)]
   WaterCutFraction ───► [WCT (Water Cut)]
   PerfTopDepth ───────► [Perf Top Depth]
   PerfBottomDepth ────► [Perf Bottom Depth]
   InterventionCode ───► [Intervention Type]
   ```

3. Open the **Format** pane (paint roller icon) → **Chart Settings** to customize colors, labels, and units.

### Developer Mode (Live Preview)

1. In Power BI Service, go to **Settings** → **Developer** → **Enable developer visual**.
2. Run `pbiviz start` locally.
3. Add the **Developer Visual** from the Visualizations pane.
4. The visual renders live from your local dev server with hot reload on code changes.

---

## Formatting Options

Available in the Power BI **Format** pane under **Chart Settings**:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| **Title** | Text | `"Production with Perforations and Interventions"` | Chart title displayed at top center |
| **Qgas Area Color** | Color | `#F4A460` (sandy orange) | Fill color of the gas production area chart |
| **WCT Line Color** | Color | `#2F4F4F` (dark slate) | Stroke color of the water cut line |
| **Perforation Box Color** | Color | `#2E8B57` (sea green) | Color of the perforation marker flanges |
| **Qgas Intervention Marker Color** | Color | `#D2691E` (orange-brown) | Color for type-1 intervention circles |
| **WCT Intervention Marker Color** | Color | `#4169E1` (royal blue) | Color for type-2 intervention circles |
| **Other Intervention Marker Color** | Color | `#DC143C` (crimson) | Color for type-3 intervention squares |
| **Qgas Unit Label** | Text | `"1000 m3/d"` | Label shown on the Qgas Y-axis |
| **WCT Unit Label** | Text | `"Fraction"` | Label shown on the WCT Y-axis |
| **Perf Depth Unit Label** | Text | `"ft"` | Label shown on the Perforations Y-axis |

---

## Data Model & Examples

### Recommended Table Structure

A single flat table (or a star schema that flattens to one via relationships):

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `Date` | Date/DateTime | `2005-08-25` | One row per time point |
| `Qgas` | Decimal | `1546.17` | Gas production rate; null if not measured |
| `WCT` | Decimal | `0.06` | Water cut fraction (0–1); null if not measured |
| `PerfTop` | Decimal | `5100` | Top depth of perforation (ft); null if no perf at this date |
| `PerfBottom` | Decimal | `5300` | Bottom depth; null if no perf at this date |
| `InterventionType` | Integer | `1` | 0/null = none, 1 = Qgas event, 2 = WCT event, 3 = Other |

### Example Data

```
Date            Qgas     WCT    PerfTop  PerfBottom  InterventionType
─────────────   ──────   ─────  ───────  ──────────  ────────────────
2005-08-25      500      0.02   null     null        0
2005-09-01      520      0.03   5100     5200        0
2005-11-15      600      0.03   5100     5200        0
2006-03-01      800      0.04   5050     5250        0
2008-06-15      1500     0.04   null     null        0
2010-03-31      1546.17  0.06   null     null        1     ← Qgas intervention
2012-07-20      1200     0.05   null     null        0
2014-01-10      900      0.07   null     null        2     ← WCT intervention
2018-09-05      400      0.10   5400     5550        3     ← Other intervention
2020-12-01      350      0.12   5400     5550        0
```

### Sample DAX Measure for Intervention Type

If your interventions are in a separate table:

```dax
InterventionType =
VAR EventDate = MAX(Interventions[EventDate])
RETURN
    IF(
        NOT ISBLANK(EventDate),
        SWITCH(
            MAX(Interventions[Category]),
            "Gas", 1,
            "Water", 2,
            3
        ),
        0
    )
```

---

## How It Works (Technical Deep Dive)

### Rendering Pipeline

```
Power BI calls update(options)
        │
        ▼
  ┌─────────────┐
  │ Clear SVG   │  Remove all previous elements
  └──────┬──────┘
         │
         ▼
  ┌──────────────────┐
  │ Validate DataView│  Check for categorical data and categories
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │ Parse Settings   │  Read formatting pane → ChartSettings object
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │ Extract Data     │  Map categorical columns to ProductionDataPoint[]
  │                  │  Sort by date ascending
  └──────┬───────────┘
         │
         ▼
  ┌──────────────────┐
  │ Render Chart     │
  │  ├─ Qgas Area    │  D3 area generator → <path>
  │  ├─ WCT Line     │  D3 line generator → <path>
  │  ├─ Perforations │  D3 data join → <g> with <rect> elements
  │  ├─ Interventions│  D3 data join → <circle>/<rect> per type
  │  ├─ Axes (×4)    │  X-axis, Left Y (perf), Right Y₁ (Qgas), Right Y₂ (WCT)
  │  ├─ Grid Lines   │  Horizontal dashed lines aligned to Qgas ticks
  │  ├─ Title        │  <text> element, centered
  │  ├─ Legend        │  Qgas swatch + WCT line sample + latest values
  │  ├─ Date Labels  │  Start/end dates at bottom corners
  │  └─ Tooltip      │  Invisible overlay rect + mouse event handlers
  └──────────────────┘
```

### D3 Scales

| Scale | Type | Domain | Range | Notes |
|-------|------|--------|-------|-------|
| `xScale` | `scaleTime` | `[minDate, maxDate]` | `[0, chartWidth]` | Shared X axis |
| `yQgasScale` | `scaleLinear` | `[0, max×1.15]` | `[chartHeight, 0]` | Right axis #1, `.nice()` |
| `yWctScale` | `scaleLinear` | `[0, max×1.15]` | `[chartHeight, 0]` | Right axis #2 (offset +55px) |
| `yPerfScale` | `scaleLinear` | `[minDepth−100, maxDepth+100]` | `[0, chartHeight]` | **Inverted** (shallow at top) |

### Layout Margins

```
┌──────────────────────────────────────────────────┐
│  top: 70px   (title 18px + legend ~22px + gap)   │
│ ┌──┬──────────────────────────────────────┬────┐ │
│ │L │                                      │  R │ │
│ │85│          Chart Area                  │120 │ │
│ │px│                                      │ px │ │
│ └──┴──────────────────────────────────────┴────┘ │
│  bottom: 55px  (X-axis ticks + date range labels)│
└──────────────────────────────────────────────────┘
```

### Data Flow

```
capabilities.json          ← defines data roles & formatting objects
        │
        ▼
Power BI Data Engine       ← applies dataReductionAlgorithm (top 30k)
        │
        ▼
DataViewCategorical        ← categories[0] = Date, values[] = measures
        │
        ▼
extractData()              ← maps columns by role name → ProductionDataPoint[]
        │
        ▼
renderChart()              ← filters into: productionData, perfData, interventions
        │
        ▼
D3 bindings                ← data join → enter → append SVG elements
```

---

## Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| **"Add data fields…"** placeholder shown | No data bound, or Date field missing | Drag a Date column into the Date field well |
| **Perforations not visible** | PerfTop / PerfBottom columns not mapped or all null | Ensure both Perf Top and Perf Bottom fields are populated for at least some dates |
| **Interventions not visible** | InterventionType is 0 or null for all rows | Ensure at least one row has InterventionType = 1, 2, or 3 |
| **WCT line flat at bottom** | WCT values very small relative to Qgas | This is expected — WCT has its own Y-axis (far right). Check the WCT axis scale. |
| **Chart looks empty** | Date field is text, not Date type | Ensure the Date column is typed as Date or DateTime in Power BI |
| **Build fails: "4 part version"** | pbiviz.json version not in `x.x.x.x` format | Use `"1.0.0.0"` format in `pbiviz.json` |
| **Build fails: "privileges"** | capabilities.json missing `privileges` array | Add `"privileges": []` to capabilities.json |
| **Certificate error on `pbiviz start`** | `pwsh` not found or no cert generated | Follow the manual certificate steps in the Building section above |

### Performance Notes

- The visual uses a **data reduction limit of 30,000 rows**. For larger datasets, aggregate at weekly/monthly granularity.
- All rendering is done in SVG. For very dense time series (>10k points), the area chart may benefit from canvas rendering (not yet implemented).
- The visual **clears and re-renders** on every update call (no differential updates).

---

## Contributing

1. Fork this repository.
2. Create a feature branch: `git checkout -b feature/my-improvement`.
3. Make changes in `src/`.
4. Test locally with `pbiviz start`.
5. Run `pbiviz package` to verify the build.
6. Submit a pull request.

### Code Style

- TypeScript strict mode.
- D3.js v7 for all DOM manipulation (no direct DOM access).
- Settings parsed from Power BI `dataView.metadata.objects` — never hard-coded in rendering code.
- All colors and labels are user-configurable via `capabilities.json` objects.

---

## License

This project is provided as-is for internal use. See your organization's licensing policies.
