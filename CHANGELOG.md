# Changelog

All notable changes to the **Production with Perforations and Interventions** Power BI custom visual.

## [1.0.0.0] – 2026-02-23

### Added
- **Qgas area chart**: Filled area showing gas production rate over time with smooth monotone-X interpolation.
- **WCT line chart**: Overlay line for water cut fraction on its own Y-axis.
- **Perforation box markers**: Wellbore-style symbols with wide green flanges (top/bottom) and narrow gray body, positioned by date (X) and sized by depth interval (Y).
- **Intervention markers**: Color-coded event markers — orange circles (Qgas), blue circles (WCT), and red squares (Other).
- **Three independent Y-axes**: Perforations depth (left, inverted), Qgas (right), WCT (far right).
- **Interactive crosshair tooltip**: Hover to see date, Qgas, WCT, perforation interval, and intervention details with automatic edge-aware positioning.
- **Legend**: Displays latest Qgas and WCT values with unit labels.
- **Date range labels**: Start/end dates at bottom corners.
- **Formatting pane**: 10 configurable properties (title, 6 colors, 3 unit labels) via Power BI Chart Settings.
- **Data reduction**: Supports up to 30,000 data points per refresh.
- **Comprehensive documentation**: README with chart anatomy, architecture, data model, build instructions, troubleshooting, and technical deep dive. Full JSDoc in all source files.

### Technical
- Built with **D3.js v7** and **Power BI Visuals API v5.9**.
- Uses `powerbi-visuals-tools v7.0.2` for packaging.
- TypeScript strict mode with `ES2020` target.
