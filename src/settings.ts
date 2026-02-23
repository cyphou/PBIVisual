/**
 * @file settings.ts
 * @description Defines the formatting pane settings for the Production with
 *   Perforations and Interventions visual. Contains the ChartSettings interface,
 *   default values, and a parser that reads user-configured values from the
 *   Power BI DataView metadata objects.
 */

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

/**
 * Configuration for all user-adjustable visual properties.
 * These map 1:1 to the "chartSettings" object in capabilities.json.
 *
 * @property chartTitle       - Text displayed at the top of the chart.
 * @property qgasColor        - Fill color for the Qgas area chart (hex string).
 * @property wctColor         - Stroke color for the WCT overlay line (hex string).
 * @property perfColor        - Color for the perforation box flanges (hex string).
 * @property qgasMarkerColor  - Color for Qgas intervention circles (hex string).
 * @property wctMarkerColor   - Color for WCT intervention circles (hex string).
 * @property otherMarkerColor - Color for "Other" intervention squares (hex string).
 * @property qgasUnit         - Unit label shown on the Qgas Y-axis (e.g. "1000 m3/d").
 * @property wctUnit          - Unit label shown on the WCT Y-axis (e.g. "Fraction").
 * @property perfUnit         - Unit label shown on the Perforation Y-axis (e.g. "ft").
 */
export interface ChartSettings {
    chartTitle: string;
    qgasColor: string;
    wctColor: string;
    perfColor: string;
    qgasMarkerColor: string;
    wctMarkerColor: string;
    otherMarkerColor: string;
    qgasUnit: string;
    wctUnit: string;
    perfUnit: string;
}

/**
 * Default settings applied when the user has not customized any property
 * in the Power BI formatting pane, or when the DataView has no metadata objects.
 */
export const defaultSettings: ChartSettings = {
    chartTitle: "Production with Perforations and Interventions",
    qgasColor: "#F4A460",        // Sandy orange for Qgas area
    wctColor: "#2F4F4F",         // Dark slate for WCT line
    perfColor: "#2E8B57",        // Sea green for perforation boxes
    qgasMarkerColor: "#D2691E",  // Orange-brown for Qgas interventions
    wctMarkerColor: "#4169E1",   // Royal blue for WCT interventions
    otherMarkerColor: "#DC143C", // Crimson for other interventions
    qgasUnit: "1000 m3/d",
    wctUnit: "Fraction",
    perfUnit: "ft"
};

/**
 * Parses user-configured settings from the Power BI DataView.
 *
 * Reads `dataView.metadata.objects["chartSettings"]` and returns a fully
 * populated {@link ChartSettings} object. Any property not set by the user
 * falls back to {@link defaultSettings}.
 *
 * @param dataView - The Power BI DataView provided in update().
 * @returns A complete ChartSettings object with user or default values.
 */
export function parseSettings(dataView: DataView): ChartSettings {
    const objects = dataView?.metadata?.objects;
    if (!objects || !objects["chartSettings"]) {
        return { ...defaultSettings };
    }

    const s = objects["chartSettings"];

    return {
        chartTitle: getStringValue(s, "chartTitle", defaultSettings.chartTitle),
        qgasColor: getFillColor(s, "qgasColor", defaultSettings.qgasColor),
        wctColor: getFillColor(s, "wctColor", defaultSettings.wctColor),
        perfColor: getFillColor(s, "perfColor", defaultSettings.perfColor),
        qgasMarkerColor: getFillColor(s, "qgasMarkerColor", defaultSettings.qgasMarkerColor),
        wctMarkerColor: getFillColor(s, "wctMarkerColor", defaultSettings.wctMarkerColor),
        otherMarkerColor: getFillColor(s, "otherMarkerColor", defaultSettings.otherMarkerColor),
        qgasUnit: getStringValue(s, "qgasUnit", defaultSettings.qgasUnit),
        wctUnit: getStringValue(s, "wctUnit", defaultSettings.wctUnit),
        perfUnit: getStringValue(s, "perfUnit", defaultSettings.perfUnit)
    };
}

/**
 * Extracts a fill color from a Power BI formatting object.
 * Power BI stores colors as `{ solid: { color: "#RRGGBB" } }`.
 *
 * @param obj        - The formatting object (e.g. objects["chartSettings"]).
 * @param prop       - Property name to read (e.g. "qgasColor").
 * @param defaultVal - Fallback hex color if the property is not set.
 * @returns The hex color string.
 */
function getFillColor(obj: any, prop: string, defaultVal: string): string {
    if (obj[prop] && obj[prop].solid) {
        return obj[prop].solid.color as string;
    }
    return defaultVal;
}

/**
 * Extracts a string value from a Power BI formatting object.
 *
 * @param obj        - The formatting object.
 * @param prop       - Property name to read.
 * @param defaultVal - Fallback value if the property is not set.
 * @returns The string value.
 */
function getStringValue(obj: any, prop: string, defaultVal: string): string {
    if (obj[prop] !== undefined && obj[prop] !== null) {
        return obj[prop] as string;
    }
    return defaultVal;
}
