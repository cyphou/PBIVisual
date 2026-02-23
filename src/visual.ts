/**
 * @file visual.ts
 * @description Main rendering module for the "Production with Perforations and
 *   Interventions" Power BI custom visual. Implements the IVisual interface and
 *   uses D3.js v7 to render:
 *
 *   1. Qgas filled area chart (gas production rate)
 *   2. WCT overlay line (water cut fraction)
 *   3. Perforation interval box markers (well-bore style with green flanges)
 *   4. Intervention event markers (colored circles / squares)
 *   5. Three Y-axes (Perforations depth, Qgas, WCT) + one X-axis (Date)
 *   6. Interactive crosshair tooltip
 *   7. Legend with latest values
 *
 * @see README.md for data model, build instructions, and formatting options.
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;
import DataViewCategorical = powerbi.DataViewCategorical;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import VisualObjectInstanceEnumeration = powerbi.VisualObjectInstanceEnumeration;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;

import { ChartSettings, defaultSettings, parseSettings } from "./settings";

// ────────────────────────────────────────
// Data Interfaces
// ────────────────────────────────────────

/**
 * Represents a single row of data after extraction from the Power BI DataView.
 * All measure fields are nullable — `null` indicates no data for that field at
 * the given date.
 */
interface ProductionDataPoint {
    /** The date/time of this data point (X-axis position). */
    date: Date;
    /** Gas production rate; shown as filled area. Null if not provided. */
    qgas: number | null;
    /** Water cut fraction (0–1); shown as overlay line. Null if not provided. */
    wct: number | null;
    /** Top depth of perforation interval (e.g. in feet). Null = no perforation. */
    perfTop: number | null;
    /** Bottom depth of perforation interval. Null = no perforation. */
    perfBottom: number | null;
    /**
     * Intervention event type code:
     * - `0` or `null` = no intervention
     * - `1` = Qgas-related event (orange circle)
     * - `2` = WCT-related event (blue circle)
     * - `3` = Other event (red square)
     */
    interventionType: number | null;
}

/**
 * Subset of data representing a single perforation interval.
 * Extracted from rows where both perfTop and perfBottom are non-null.
 */
interface PerforationInterval {
    /** Date the perforation is associated with (X-axis position). */
    date: Date;
    /** Shallowest depth of the interval. */
    topDepth: number;
    /** Deepest depth of the interval. */
    bottomDepth: number;
}

/**
 * Subset of data representing a discrete intervention event.
 * Extracted from rows where interventionType > 0.
 */
interface InterventionEvent {
    /** Date of the intervention (X-axis position). */
    date: Date;
    /** Type code: 1 = Qgas, 2 = WCT, 3 = Other. */
    type: number;
    /** Qgas value at the time (used for Y positioning of type 1 & 3 markers). */
    qgas: number | null;
    /** WCT value at the time (used for Y positioning of type 2 markers). */
    wct: number | null;
}

// ────────────────────────────────────────
// Main Visual Class
// ────────────────────────────────────────

/**
 * Main Power BI visual class implementing {@link IVisual}.
 *
 * Lifecycle:
 * 1. Power BI instantiates the class once via `constructor()`.
 * 2. On every data refresh, resize, or formatting change, Power BI calls `update()`.
 * 3. When the user opens the Format pane, `enumerateObjectInstances()` provides
 *    the list of configurable properties.
 *
 * Rendering is performed entirely in SVG using D3.js v7. The chart is cleared
 * and re-drawn on each `update()` call (no incremental / differential updates).
 */
export class Visual implements IVisual {
    /** The root HTML element provided by Power BI to host the visual. */
    private target: HTMLElement;
    /** The Power BI host services (colors, tooltip, selection, etc.). */
    private host: IVisualHost;
    /** Root SVG element appended to the target. */
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    /** Power BI tooltip service for native tooltips. */
    private tooltipService: ITooltipService;
    /** Power BI selection manager for cross-visual filtering. */
    private selectionManager: ISelectionManager;
    /** Current user-configured settings (or defaults). */
    private settings: ChartSettings;

    /**
     * Fixed pixel margins around the chart area.
     * - `top`    : space for title (18px) + legend (~22px) + padding
     * - `right`  : space for two right Y-axes (Qgas at +0px, WCT at +55px)
     * - `bottom` : space for X-axis tick labels + date range corner labels
     * - `left`   : space for the Perforations Y-axis label + ticks
     */
    private readonly margin = {
        top: 70,
        right: 120,
        bottom: 55,
        left: 85
    };

    /**
     * Called once when Power BI creates the visual instance.
     * Sets up the root SVG element and initialises host services.
     *
     * @param options - Contains the target HTML element and host interface.
     */
    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.host = options.host;
        this.tooltipService = this.host.tooltipService;
        this.selectionManager = this.host.createSelectionManager();
        this.settings = { ...defaultSettings };

        // Create root SVG — the single top-level element for all rendering.
        this.svg = d3.select(this.target)
            .append("svg")
            .classed("production-perf-chart", true);
    }

    // ────────────────────────────────────
    // UPDATE – Main entry point
    // ────────────────────────────────────

    /**
     * Called by Power BI whenever the visual needs to re-render.
     * Triggers include: data change, viewport resize, or formatting change.
     *
     * Steps:
     * 1. Clears all existing SVG content.
     * 2. Validates the incoming DataView.
     * 3. Parses formatting pane settings.
     * 4. Extracts typed data points from the categorical DataView.
     * 5. Delegates to `renderChart()` for full rendering.
     *
     * @param options - Contains the viewport size and dataViews array.
     */
    public update(options: VisualUpdateOptions): void {
        // Clear previous render
        this.svg.selectAll("*").remove();

        const width = options.viewport.width;
        const height = options.viewport.height;

        this.svg
            .attr("width", width)
            .attr("height", height);

        // Validate dataView
        const dataView = options?.dataViews?.[0];
        if (!dataView || !dataView.categorical || !dataView.categorical.categories
            || dataView.categorical.categories.length === 0) {
            this.renderNoData(width, height);
            return;
        }

        // Parse settings from formatting pane
        this.settings = parseSettings(dataView);

        // Extract data
        const allData = this.extractData(dataView.categorical);
        if (allData.length === 0) {
            this.renderNoData(width, height);
            return;
        }

        // Render chart
        this.renderChart(allData, width, height);
    }

    // ────────────────────────────────────
    // DATA EXTRACTION
    // ────────────────────────────────────

    /**
     * Converts the Power BI categorical DataView into a typed array of
     * {@link ProductionDataPoint} objects, sorted by date ascending.
     *
     * The method matches value columns to data roles by inspecting
     * `col.source.roles` (e.g. `{ "qgasField": true }`).
     *
     * @param categorical - The categorical DataView from `dataView.categorical`.
     * @returns Sorted array of data points; empty if no valid data.
     */
    private extractData(categorical: DataViewCategorical): ProductionDataPoint[] {
        const categories = categorical.categories![0]; // date field
        const values = categorical.values;
        if (!categories || !values) return [];

        const dateValues = categories.values;
        const dataPoints: ProductionDataPoint[] = [];

        // Find value columns by role
        let qgasCol: powerbi.DataViewValueColumn | undefined;
        let wctCol: powerbi.DataViewValueColumn | undefined;
        let perfTopCol: powerbi.DataViewValueColumn | undefined;
        let perfBottomCol: powerbi.DataViewValueColumn | undefined;
        let interventionCol: powerbi.DataViewValueColumn | undefined;

        for (const col of values) {
            const roles = col.source.roles;
            if (!roles) continue;
            if (roles["qgasField"]) qgasCol = col;
            if (roles["wctField"]) wctCol = col;
            if (roles["perfTopField"]) perfTopCol = col;
            if (roles["perfBottomField"]) perfBottomCol = col;
            if (roles["interventionTypeField"]) interventionCol = col;
        }

        for (let i = 0; i < dateValues.length; i++) {
            const rawDate = dateValues[i];
            const date = rawDate instanceof Date ? rawDate : new Date(rawDate as string);
            if (isNaN(date.getTime())) continue;

            dataPoints.push({
                date,
                qgas: this.numOrNull(qgasCol?.values[i]),
                wct: this.numOrNull(wctCol?.values[i]),
                perfTop: this.numOrNull(perfTopCol?.values[i]),
                perfBottom: this.numOrNull(perfBottomCol?.values[i]),
                interventionType: this.numOrNull(interventionCol?.values[i])
            });
        }

        // Sort by date
        dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());
        return dataPoints;
    }

    /**
     * Safely converts any value to a number, returning `null` for
     * undefined, null, empty string, or NaN inputs.
     *
     * @param val - Raw value from the DataView (could be string, number, etc.).
     * @returns The numeric value or `null`.
     */
    private numOrNull(val: any): number | null {
        if (val === undefined || val === null || val === "") return null;
        const n = +val;
        return isNaN(n) ? null : n;
    }

    // ────────────────────────────────────
    // RENDERING
    // ────────────────────────────────────

    /**
     * Master rendering method. Computes scales, creates the chart group with
     * clip path, then draws each visual layer in order:
     *
     * 1. **Qgas area chart** — D3 area generator with monotone-X interpolation.
     * 2. **WCT line chart** — D3 line generator overlaid on the area.
     * 3. **Perforation box markers** — Well-bore style: wide green flanges
     *    (top/bottom) connected by a narrow gray vertical body. X = date,
     *    Y/height = perforation depth interval on the left (inverted) axis.
     * 4. **Intervention markers** — Circles (type 1, 2) or squares (type 3)
     *    positioned at the event date and corresponding Y value.
     * 5. **Axes** — X (dates), left Y (perf depth, inverted), right Y₁ (Qgas),
     *    right Y₂ (WCT, offset +55px further right).
     * 6. **Grid lines** — Horizontal dashed lines aligned to Qgas ticks.
     * 7. **Title** — Centered text from settings.
     * 8. **Legend** — Qgas swatch + WCT line sample + latest non-null values.
     * 9. **Date range labels** — Start/end dates in bottom corners.
     * 10. **Tooltip overlay** — Invisible rect for crosshair mouse tracking.
     *
     * @param data   - All data points, sorted by date.
     * @param width  - Current viewport width (pixels).
     * @param height - Current viewport height (pixels).
     */
    private renderChart(data: ProductionDataPoint[], width: number, height: number): void {
        const { top, right, bottom, left } = this.margin;
        const chartWidth = Math.max(width - left - right, 50);
        const chartHeight = Math.max(height - top - bottom, 50);
        const s = this.settings;

        // ── Separate data subsets ──
        const productionData = data.filter(d => d.qgas !== null || d.wct !== null);
        const perfData: PerforationInterval[] = data
            .filter(d => d.perfTop !== null && d.perfBottom !== null)
            .map(d => ({ date: d.date, topDepth: d.perfTop!, bottomDepth: d.perfBottom! }));
        const interventions: InterventionEvent[] = data
            .filter(d => d.interventionType !== null && d.interventionType! > 0)
            .map(d => ({
                date: d.date,
                type: d.interventionType!,
                qgas: d.qgas,
                wct: d.wct
            }));

        // ── Scales ──
        const xExtent = d3.extent(data, d => d.date) as [Date, Date];
        const xScale = d3.scaleTime().domain(xExtent).range([0, chartWidth]);

        // Qgas scale (right axis #1)
        const qgasMax = d3.max(productionData, d => d.qgas ?? 0) ?? 100;
        const yQgasScale = d3.scaleLinear()
            .domain([0, qgasMax * 1.15])
            .range([chartHeight, 0])
            .nice();

        // WCT scale (right axis #2)
        const wctMax = d3.max(productionData, d => d.wct ?? 0) ?? 1;
        const yWctScale = d3.scaleLinear()
            .domain([0, Math.max(wctMax * 1.15, 1)])
            .range([chartHeight, 0])
            .nice();

        // Perforation depth scale (left axis – inverted so deeper = lower)
        let perfMin = 0, perfMax = 100;
        if (perfData.length > 0) {
            perfMin = d3.min(perfData, d => Math.min(d.topDepth, d.bottomDepth))! - 100;
            perfMax = d3.max(perfData, d => Math.max(d.topDepth, d.bottomDepth))! + 100;
        }
        const yPerfScale = d3.scaleLinear()
            .domain([perfMin, perfMax])
            .range([0, chartHeight]); // inverted: smaller depth at top

        // ── Chart group ──
        const chart = this.svg.append("g")
            .attr("transform", `translate(${left},${top})`);

        // ── Clip path to contain chart elements ──
        this.svg.append("defs")
            .append("clipPath")
            .attr("id", "chart-clip")
            .append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", chartWidth)
            .attr("height", chartHeight);

        const clippedGroup = chart.append("g")
            .attr("clip-path", "url(#chart-clip)");

        // ════════════════════════════════════
        // 1. QGAS AREA CHART
        // ════════════════════════════════════
        const qgasData = productionData.filter(d => d.qgas !== null);
        if (qgasData.length > 0) {
            const areaGen = d3.area<ProductionDataPoint>()
                .x(d => xScale(d.date))
                .y0(chartHeight)
                .y1(d => yQgasScale(d.qgas!))
                .curve(d3.curveMonotoneX);

            clippedGroup.append("path")
                .datum(qgasData)
                .attr("class", "qgas-area")
                .attr("d", areaGen)
                .attr("fill", s.qgasColor)
                .attr("fill-opacity", 0.7)
                .attr("stroke", "none");

            // Top edge line for definition
            const lineGen = d3.line<ProductionDataPoint>()
                .x(d => xScale(d.date))
                .y(d => yQgasScale(d.qgas!))
                .curve(d3.curveMonotoneX);

            clippedGroup.append("path")
                .datum(qgasData)
                .attr("class", "qgas-line")
                .attr("d", lineGen)
                .attr("fill", "none")
                .attr("stroke", d3.color(s.qgasColor)!.darker(0.5).toString())
                .attr("stroke-width", 0.5);
        }

        // ════════════════════════════════════
        // 2. WCT LINE CHART
        // ════════════════════════════════════
        const wctData = productionData.filter(d => d.wct !== null);
        if (wctData.length > 0) {
            const wctLine = d3.line<ProductionDataPoint>()
                .x(d => xScale(d.date))
                .y(d => yWctScale(d.wct!))
                .curve(d3.curveMonotoneX);

            clippedGroup.append("path")
                .datum(wctData)
                .attr("class", "wct-line")
                .attr("d", wctLine)
                .attr("fill", "none")
                .attr("stroke", s.wctColor)
                .attr("stroke-width", 1.5);
        }

        // ════════════════════════════════════
        // 3. PERFORATION BOX MARKERS
        //    Wellbore-style: wide green horizontal flanges at
        //    top & bottom, narrow gray body in between.
        // ════════════════════════════════════
        if (perfData.length > 0) {
            const flangeWidth = Math.max(18, Math.min(36, chartWidth / perfData.length * 0.7));
            const bodyWidth = flangeWidth * 0.45;   // narrower body
            const flangeHeight = 8;                  // thickness of each green bar

            const perfGroup = clippedGroup.selectAll(".perf-box")
                .data(perfData)
                .enter()
                .append("g")
                .attr("class", "perf-box")
                .attr("transform", d => `translate(${xScale(d.date)},0)`);

            // Narrow gray body (vertical bar between the two flanges)
            perfGroup.append("rect")
                .attr("x", -bodyWidth / 2)
                .attr("y", d => yPerfScale(Math.min(d.topDepth, d.bottomDepth)))
                .attr("width", bodyWidth)
                .attr("height", d => Math.max(1, Math.abs(yPerfScale(d.bottomDepth) - yPerfScale(d.topDepth))))
                .attr("fill", "#D8D8D8")
                .attr("stroke", "#999")
                .attr("stroke-width", 0.5);

            // Wide green TOP flange
            perfGroup.append("rect")
                .attr("x", -flangeWidth / 2)
                .attr("y", d => yPerfScale(Math.min(d.topDepth, d.bottomDepth)) - flangeHeight / 2)
                .attr("width", flangeWidth)
                .attr("height", flangeHeight)
                .attr("rx", 1.5)
                .attr("fill", s.perfColor)
                .attr("stroke", d3.color(s.perfColor)!.darker(0.3).toString())
                .attr("stroke-width", 0.7);

            // Wide green BOTTOM flange
            perfGroup.append("rect")
                .attr("x", -flangeWidth / 2)
                .attr("y", d => yPerfScale(Math.max(d.topDepth, d.bottomDepth)) - flangeHeight / 2)
                .attr("width", flangeWidth)
                .attr("height", flangeHeight)
                .attr("rx", 1.5)
                .attr("fill", s.perfColor)
                .attr("stroke", d3.color(s.perfColor)!.darker(0.3).toString())
                .attr("stroke-width", 0.7);
        }

        // ════════════════════════════════════
        // 4. INTERVENTION MARKERS
        // ════════════════════════════════════
        if (interventions.length > 0) {
            const markerGroup = clippedGroup.selectAll(".intervention-marker")
                .data(interventions)
                .enter()
                .append("g")
                .attr("class", "intervention-marker");

            markerGroup.each((d, i, nodes) => {
                const el = d3.select(nodes[i]);
                const x = xScale(d.date);

                if (d.type === 1) {
                    // Qgas intervention → orange circle positioned on Qgas scale
                    const y = d.qgas !== null ? yQgasScale(d.qgas) : chartHeight * 0.8;
                    el.append("circle")
                        .attr("cx", x)
                        .attr("cy", y)
                        .attr("r", 6)
                        .attr("fill", s.qgasMarkerColor)
                        .attr("fill-opacity", 0.85)
                        .attr("stroke", d3.color(s.qgasMarkerColor)!.darker(0.4).toString())
                        .attr("stroke-width", 1);
                } else if (d.type === 2) {
                    // WCT intervention → blue circle positioned on WCT scale
                    const y = d.wct !== null ? yWctScale(d.wct) : chartHeight * 0.9;
                    el.append("circle")
                        .attr("cx", x)
                        .attr("cy", y)
                        .attr("r", 6)
                        .attr("fill", s.wctMarkerColor)
                        .attr("fill-opacity", 0.85)
                        .attr("stroke", d3.color(s.wctMarkerColor)!.darker(0.4).toString())
                        .attr("stroke-width", 1);
                } else if (d.type === 3) {
                    // Other intervention → red square
                    const y = d.qgas !== null ? yQgasScale(d.qgas) : chartHeight * 0.5;
                    el.append("rect")
                        .attr("x", x - 5)
                        .attr("y", y - 5)
                        .attr("width", 10)
                        .attr("height", 10)
                        .attr("fill", s.otherMarkerColor)
                        .attr("fill-opacity", 0.85)
                        .attr("stroke", d3.color(s.otherMarkerColor)!.darker(0.4).toString())
                        .attr("stroke-width", 1);
                }
            });
        }

        // ════════════════════════════════════
        // 5. AXES
        // ════════════════════════════════════

        // X-Axis (bottom – dates)
        const xAxis = d3.axisBottom(xScale)
            .ticks(Math.max(Math.floor(chartWidth / 120), 3))
            .tickFormat(d => {
                const date = d as Date;
                return d3.timeFormat("%b %d, %Y")(date);
            });

        chart.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${chartHeight})`)
            .call(xAxis)
            .selectAll("text")
            .attr("font-size", "10px")
            .attr("fill", "#555");

        // Left Y-Axis – Perforations (ft)
        const yPerfAxis = d3.axisLeft(yPerfScale)
            .ticks(6)
            .tickFormat(d => d3.format(",.0f")(d as number));

        chart.append("g")
            .attr("class", "y-axis-perf")
            .call(yPerfAxis)
            .selectAll("text")
            .attr("font-size", "10px")
            .attr("fill", "#555");

        chart.append("text")
            .attr("transform", "rotate(-90)")
            .attr("y", -65)
            .attr("x", -chartHeight / 2)
            .attr("text-anchor", "middle")
            .attr("font-size", "11px")
            .attr("fill", "#555")
            .text(`Perforations (${s.perfUnit})`);

        // Right Y-Axis #1 – Qgas
        const yQgasAxis = d3.axisRight(yQgasScale)
            .ticks(6)
            .tickFormat(d => d3.format(",.0f")(d as number));

        chart.append("g")
            .attr("class", "y-axis-qgas")
            .attr("transform", `translate(${chartWidth},0)`)
            .call(yQgasAxis)
            .selectAll("text")
            .attr("font-size", "10px")
            .attr("fill", s.qgasColor);

        chart.append("text")
            .attr("transform", "rotate(90)")
            .attr("y", -(chartWidth + 45))
            .attr("x", chartHeight / 2)
            .attr("text-anchor", "middle")
            .attr("font-size", "11px")
            .attr("fill", d3.color(s.qgasColor)!.darker(0.5).toString())
            .text(`Qgas (${s.qgasUnit})`);

        // Right Y-Axis #2 – WCT (offset further right)
        const yWctAxis = d3.axisRight(yWctScale)
            .ticks(6)
            .tickFormat(d => d3.format(".2f")(d as number));

        chart.append("g")
            .attr("class", "y-axis-wct")
            .attr("transform", `translate(${chartWidth + 55},0)`)
            .call(yWctAxis)
            .selectAll("text")
            .attr("font-size", "10px")
            .attr("fill", s.wctColor);

        chart.append("text")
            .attr("transform", "rotate(90)")
            .attr("y", -(chartWidth + 100))
            .attr("x", chartHeight / 2)
            .attr("text-anchor", "middle")
            .attr("font-size", "11px")
            .attr("fill", s.wctColor)
            .text(`WCT (${s.wctUnit})`);

        // ── Grid lines ──
        chart.append("g")
            .attr("class", "grid-lines")
            .selectAll("line")
            .data(yQgasScale.ticks(6))
            .enter()
            .append("line")
            .attr("x1", 0)
            .attr("x2", chartWidth)
            .attr("y1", d => yQgasScale(d))
            .attr("y2", d => yQgasScale(d))
            .attr("stroke", "#e0e0e0")
            .attr("stroke-width", 0.5)
            .attr("stroke-dasharray", "3,3");

        // ════════════════════════════════════
        // 6. TITLE
        // ════════════════════════════════════
        this.svg.append("text")
            .attr("x", width / 2)
            .attr("y", 18)
            .attr("text-anchor", "middle")
            .attr("font-size", "14px")
            .attr("font-weight", "bold")
            .attr("fill", "#333")
            .text(s.chartTitle);

        // ════════════════════════════════════
        // 7. LEGEND
        // ════════════════════════════════════
        this.renderLegend(width, productionData, s);

        // ════════════════════════════════════
        // 8. DATE RANGE LABELS
        // ════════════════════════════════════
        if (xExtent[0] && xExtent[1]) {
            const fmt = d3.timeFormat("%b %d %Y");
            this.svg.append("text")
                .attr("x", left)
                .attr("y", height - 5)
                .attr("text-anchor", "start")
                .attr("font-size", "10px")
                .attr("fill", "#777")
                .text(fmt(xExtent[0]));

            this.svg.append("text")
                .attr("x", width - right)
                .attr("y", height - 5)
                .attr("text-anchor", "end")
                .attr("font-size", "10px")
                .attr("fill", "#777")
                .text(fmt(xExtent[1]));
        }

        // ════════════════════════════════════
        // 9. TOOLTIP OVERLAY
        // ════════════════════════════════════
        this.addTooltipOverlay(chart, data, xScale, yQgasScale, yWctScale, chartWidth, chartHeight, s);
    }

    // ────────────────────────────────────
    // LEGEND
    // ────────────────────────────────────

    /**
     * Renders the legend below the title showing:
     * - A filled rectangle swatch + label for Qgas with the latest non-null value.
     * - A line dash + label for WCT with the latest non-null value.
     *
     * @param width          - Viewport width for positioning.
     * @param productionData - Filtered data points that have Qgas or WCT values.
     * @param s              - Current chart settings (colors, units).
     */
    private renderLegend(
        width: number,
        productionData: ProductionDataPoint[],
        s: ChartSettings
    ): void {
        const legendY = 38;
        const legendGroup = this.svg.append("g")
            .attr("class", "legend")
            .attr("transform", `translate(${this.margin.left}, ${legendY})`);

        // Latest values for legend display
        const lastQgas = this.getLastNonNull(productionData, d => d.qgas);
        const lastWct = this.getLastNonNull(productionData, d => d.wct);

        // Qgas legend item
        let xOff = 0;
        legendGroup.append("rect")
            .attr("x", xOff)
            .attr("y", -6)
            .attr("width", 14)
            .attr("height", 12)
            .attr("fill", s.qgasColor)
            .attr("fill-opacity", 0.7);

        xOff += 18;
        const qgasLabel = `Qgas ${lastQgas !== null ? d3.format(",.2f")(lastQgas) : "—"} (${s.qgasUnit})`;
        legendGroup.append("text")
            .attr("x", xOff)
            .attr("y", 4)
            .attr("font-size", "11px")
            .attr("fill", "#333")
            .text(qgasLabel);

        xOff += qgasLabel.length * 6.5 + 20;

        // WCT legend item
        legendGroup.append("line")
            .attr("x1", xOff)
            .attr("x2", xOff + 20)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", s.wctColor)
            .attr("stroke-width", 2);

        xOff += 25;
        const wctLabel = `WCT ${lastWct !== null ? d3.format(".2f")(lastWct) : "—"} (${s.wctUnit})`;
        legendGroup.append("text")
            .attr("x", xOff)
            .attr("y", 4)
            .attr("font-size", "11px")
            .attr("fill", "#333")
            .text(wctLabel);
    }

    /**
     * Walks the data array backwards to find the last non-null value for a
     * given accessor. Used to display the latest Qgas / WCT value in the legend.
     *
     * @param data     - Array of data points (sorted by date ascending).
     * @param accessor - Function that extracts the numeric field to check.
     * @returns The last non-null value, or `null` if all values are null.
     */
    private getLastNonNull(data: ProductionDataPoint[], accessor: (d: ProductionDataPoint) => number | null): number | null {
        for (let i = data.length - 1; i >= 0; i--) {
            const val = accessor(data[i]);
            if (val !== null) return val;
        }
        return null;
    }

    // ────────────────────────────────────
    // TOOLTIP OVERLAY (invisible rect for mouse tracking)
    // ────────────────────────────────────

    /**
     * Creates an interactive tooltip system with:
     *
     * - **Focus group**: A vertical dashed line + colored circles that snap to
     *   the nearest data point as the mouse moves horizontally.
     * - **Tooltip box**: A floating `<rect>` + `<text>` group showing Date,
     *   Qgas, WCT, Perforation interval, and Intervention type.
     * - **Overlay rect**: An invisible rectangle covering the chart area that
     *   captures mouseover/mousemove/mouseout events.
     *
     * Uses `d3.bisector` to find the closest data point to the mouse X position.
     * The tooltip automatically flips left/right to stay within chart bounds.
     *
     * @param chart       - The main chart `<g>` group (translated by margins).
     * @param data        - All data points sorted by date.
     * @param xScale      - Time scale for the X-axis.
     * @param yQgasScale  - Linear scale for the Qgas right Y-axis.
     * @param yWctScale   - Linear scale for the WCT far-right Y-axis.
     * @param chartWidth  - Width of the chart area (excluding margins).
     * @param chartHeight - Height of the chart area (excluding margins).
     * @param s           - Current chart settings.
     */
    private addTooltipOverlay(
        chart: d3.Selection<SVGGElement, unknown, null, undefined>,
        data: ProductionDataPoint[],
        xScale: d3.ScaleTime<number, number>,
        yQgasScale: d3.ScaleLinear<number, number>,
        yWctScale: d3.ScaleLinear<number, number>,
        chartWidth: number,
        chartHeight: number,
        s: ChartSettings
    ): void {
        const bisectDate = d3.bisector<ProductionDataPoint, Date>(d => d.date).left;

        // Focus elements (vertical line + circles)
        const focusGroup = chart.append("g")
            .attr("class", "focus-group")
            .style("display", "none");

        focusGroup.append("line")
            .attr("class", "focus-line")
            .attr("y1", 0)
            .attr("y2", chartHeight)
            .attr("stroke", "#999")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4,3");

        const qgasCircle = focusGroup.append("circle")
            .attr("r", 5)
            .attr("fill", s.qgasColor)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);

        const wctCircle = focusGroup.append("circle")
            .attr("r", 4)
            .attr("fill", s.wctColor)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);

        // Tooltip box
        const tooltipGroup = chart.append("g")
            .attr("class", "tooltip-box")
            .style("display", "none");

        const tooltipRect = tooltipGroup.append("rect")
            .attr("rx", 4)
            .attr("ry", 4)
            .attr("fill", "rgba(255,255,255,0.95)")
            .attr("stroke", "#ccc")
            .attr("stroke-width", 1);

        const tooltipText = tooltipGroup.append("text")
            .attr("font-size", "11px")
            .attr("fill", "#333");

        // Invisible overlay for mouse events
        chart.append("rect")
            .attr("class", "overlay")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "none")
            .attr("pointer-events", "all")
            .on("mouseover", () => {
                focusGroup.style("display", null);
                tooltipGroup.style("display", null);
            })
            .on("mouseout", () => {
                focusGroup.style("display", "none");
                tooltipGroup.style("display", "none");
            })
            .on("mousemove", (event: MouseEvent) => {
                const [mx] = d3.pointer(event);
                const dateAtMouse = xScale.invert(mx);
                const idx = bisectDate(data, dateAtMouse, 1);
                const d0 = data[idx - 1];
                const d1 = data[idx];
                if (!d0) return;

                const dp = (!d1 || (dateAtMouse.getTime() - d0.date.getTime()) < (d1.date.getTime() - dateAtMouse.getTime()))
                    ? d0 : d1;

                const x = xScale(dp.date);

                // Move focus line
                focusGroup.select(".focus-line")
                    .attr("x1", x)
                    .attr("x2", x);

                // Position Qgas circle
                if (dp.qgas !== null) {
                    qgasCircle
                        .attr("cx", x)
                        .attr("cy", yQgasScale(dp.qgas))
                        .style("display", null);
                } else {
                    qgasCircle.style("display", "none");
                }

                // Position WCT circle
                if (dp.wct !== null) {
                    wctCircle
                        .attr("cx", x)
                        .attr("cy", yWctScale(dp.wct))
                        .style("display", null);
                } else {
                    wctCircle.style("display", "none");
                }

                // Build tooltip text
                const dateStr = d3.timeFormat("%b %d %Y %H:%M")(dp.date);
                const lines: string[] = [`Date: ${dateStr}`];
                if (dp.qgas !== null) lines.push(`Qgas: ${d3.format(",.2f")(dp.qgas)}`);
                if (dp.wct !== null) lines.push(`WCT: ${d3.format(".4f")(dp.wct)}`);
                if (dp.perfTop !== null && dp.perfBottom !== null) {
                    lines.push(`Perf: ${d3.format(",.0f")(dp.perfTop)} – ${d3.format(",.0f")(dp.perfBottom)} ${s.perfUnit}`);
                }
                if (dp.interventionType !== null && dp.interventionType > 0) {
                    const typeLabels: Record<number, string> = { 1: "Qgas Event", 2: "WCT Event", 3: "Other" };
                    lines.push(`Intervention: ${typeLabels[dp.interventionType] || "Unknown"}`);
                }

                // Render tooltip text
                tooltipText.selectAll("tspan").remove();
                lines.forEach((line, i) => {
                    tooltipText.append("tspan")
                        .attr("x", 8)
                        .attr("dy", i === 0 ? 16 : 15)
                        .text(line);
                });

                // Size tooltip background
                const textBBox = (tooltipText.node() as SVGTextElement).getBBox();
                const ttW = textBBox.width + 16;
                const ttH = textBBox.height + 10;
                tooltipRect
                    .attr("width", ttW)
                    .attr("height", ttH);

                // Position tooltip (flip side if near right edge)
                let ttX = x + 12;
                if (ttX + ttW > chartWidth) {
                    ttX = x - ttW - 12;
                }
                let ttY = Math.max(10, Math.min(chartHeight - ttH - 10, (dp.qgas !== null ? yQgasScale(dp.qgas) : chartHeight / 2) - ttH / 2));

                tooltipGroup.attr("transform", `translate(${ttX},${ttY})`);
            });
    }

    // ────────────────────────────────────
    // NO DATA placeholder
    // ────────────────────────────────────

    /**
     * Renders a centered placeholder message when no valid data is available.
     * Displayed when the DataView is missing, has no categories, or yields
     * zero data points after extraction.
     *
     * @param width  - Viewport width.
     * @param height - Viewport height.
     */
    private renderNoData(width: number, height: number): void {
        this.svg.append("text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-size", "14px")
            .attr("fill", "#999")
            .text("Add data fields: Date, Qgas, WCT, Perf Top/Bottom, Intervention Type");
    }

    // ────────────────────────────────────
    // FORMAT PANE – enumerate properties
    // ────────────────────────────────────

    /**
     * Called by Power BI when the user opens the Format pane.
     * Returns the list of configurable properties and their current values
     * for the requested object name ("chartSettings").
     *
     * This method enables users to change colors, labels, titles, and units
     * without editing code.
     *
     * @param options - Contains `objectName` identifying which settings group
     *   Power BI is requesting (matches keys in capabilities.json "objects").
     * @returns An array of VisualObjectInstance with current property values.
     */
    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
        const instances: VisualObjectInstance[] = [];
        const s = this.settings;

        if (options.objectName === "chartSettings") {
            instances.push({
                objectName: "chartSettings",
                displayName: "Chart Settings",
                selector: null,
                properties: {
                    chartTitle: s.chartTitle,
                    qgasColor: { solid: { color: s.qgasColor } },
                    wctColor: { solid: { color: s.wctColor } },
                    perfColor: { solid: { color: s.perfColor } },
                    qgasMarkerColor: { solid: { color: s.qgasMarkerColor } },
                    wctMarkerColor: { solid: { color: s.wctMarkerColor } },
                    otherMarkerColor: { solid: { color: s.otherMarkerColor } },
                    qgasUnit: s.qgasUnit,
                    wctUnit: s.wctUnit,
                    perfUnit: s.perfUnit
                }
            });
        }

        return instances;
    }
}
