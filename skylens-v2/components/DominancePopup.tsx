import React, { useMemo } from "react";
import type { DataPoint, AttributeConfig } from "../types";

type DominancePopupProps = {
  x: number;
  y: number;

  skylinePoints: DataPoint[];

  dominatedPoints: DataPoint[];

  attributes: AttributeConfig[];

  colors?: Record<string, string>;

  // Popup dimensions
  size?: number;
  padding?: number; // popup padding

  // Display information
  title?: string;
  subtitle?: string;

  scales?: Record<string, { min: number; max: number }>;

  // Visual parameters
  dominatedStroke?: string;
  dominatedOpacity?: number;
  dominatedStrokeWidth?: number;

  skylineStrokeWidth?: number;
  skylineFillOpacity?: number;

  // Whether to show axis labels
  showAxisLabels?: boolean;

  // z-index
  zIndex?: number;
};

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function getNumber(obj: any, key: string) {
  const v = Number(obj?.[key]);
  return Number.isFinite(v) ? v : 0;
}

function computePolygonPath(
  values01: number[],
  cx: number,
  cy: number,
  r: number,
  startAngleRad: number
) {
  const n = values01.length;
  if (n === 0) return "";
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = startAngleRad + (i * 2 * Math.PI) / n;
    const rr = r * clamp01(values01[i]);
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  d += " Z";
  return d;
}

export default function DominancePopup({
  x,
  y,
  skylinePoints,
  dominatedPoints,
  attributes,
  colors = {},
  size = 260,
  padding = 10,
  title,
  subtitle,
  scales,
  dominatedStroke = "rgba(148,163,184,0.35)",
  dominatedOpacity = 1,
  dominatedStrokeWidth = 1,
  skylineStrokeWidth = 2.5,
  skylineFillOpacity = 0.10,
  showAxisLabels = true,
  zIndex = 9999,
}: DominancePopupProps) {
  const dims = attributes.length;

  const allPoints = useMemo(() => {
    return [...(skylinePoints ?? []), ...(dominatedPoints ?? [])];
  }, [skylinePoints, dominatedPoints]);

  const autoScales = useMemo(() => {
    const out: Record<string, { min: number; max: number }> = {};
    for (const a of attributes) {
      const key = a.key;
      let mn =
        typeof a.min === "number"
          ? a.min
          : Number.POSITIVE_INFINITY;
      let mx =
        typeof a.max === "number"
          ? a.max
          : Number.NEGATIVE_INFINITY;

      if (!(typeof a.min === "number" && typeof a.max === "number")) {
        for (const p of allPoints) {
          const v = getNumber(p as any, key);
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }

      if (!Number.isFinite(mn)) mn = 0;
      if (!Number.isFinite(mx)) mx = mn + 1;

      if (mx - mn < 1e-12) mx = mn + 1;

      out[key] = { min: mn, max: mx };
    }
    return out;
  }, [attributes, allPoints]);

  const usedScales = scales ?? autoScales;

  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) * 0.80;
  const startAngle = -Math.PI / 2;

  const axisPts = useMemo(() => {
    const pts = [];
    for (let i = 0; i < dims; i++) {
      const a = startAngle + (i * 2 * Math.PI) / dims;
      pts.push({
        x: cx + r * Math.cos(a),
        y: cy + r * Math.sin(a),
        a,
      });
    }
    return pts;
  }, [dims, cx, cy, r, startAngle]);

  const normalizePoint = (p: DataPoint) => {
    const vals01 = new Array(dims);
    for (let i = 0; i < dims; i++) {
      const attr = attributes[i];
      const s = usedScales[attr.key];
      const v = getNumber(p as any, attr.key);
      vals01[i] = clamp01((v - s.min) / (s.max - s.min));
    }
    return vals01;
  };

  const dominatedPaths = useMemo(() => {
    if (!dominatedPoints || dominatedPoints.length === 0) return [];
    return dominatedPoints.map((p) => {
      const vals01 = normalizePoint(p);
      return computePolygonPath(vals01, cx, cy, r, startAngle);
    });
  }, [dominatedPoints, dims, attributes, usedScales, cx, cy, r, startAngle]);

  const skylineSeries = useMemo(() => {
    return (skylinePoints ?? []).map((p) => {
      const vals01 = normalizePoint(p);
      return {
        id: (p as any).id as string,
        name: (p as any).name ?? (p as any).id,
        path: computePolygonPath(vals01, cx, cy, r, startAngle),
        color: colors[(p as any).id] ?? "rgba(168,85,247,1)",
      };
    });
  }, [skylinePoints, dims, attributes, usedScales, cx, cy, r, startAngle, colors]);

  const popupLeft = x + 12;
  const popupTop = y + 12;

  return (
    <div
      style={{
        position: "fixed",
        left: popupLeft,
        top: popupTop,
        width: size + padding * 2,
        padding,
        borderRadius: 14,
        background: "rgba(10, 15, 25, 0.96)",
        border: "1px solid rgba(148, 163, 184, 0.25)",
        boxShadow: "0 20px 70px rgba(0,0,0,0.55)",
        zIndex,
        pointerEvents: "none",
      }}
    >
      {(title || subtitle) && (
        <div style={{ marginBottom: 8 }}>
          {title && (
            <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(248,250,252,0.95)" }}>
              {title}
            </div>
          )}
          {subtitle && (
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        {skylineSeries.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: s.color,
                boxShadow: "0 0 0 1px rgba(255,255,255,0.15) inset",
              }}
            />
            <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.9 }}>
              {s.name}
            </div>
          </div>
        ))}
        {dominatedPoints.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 6 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: dominatedStroke,
                boxShadow: "0 0 0 1px rgba(255,255,255,0.10) inset",
              }}
            />
            <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.7 }}>
              Dominated ({dominatedPoints.length})
            </div>
          </div>
        )}
      </div>

      <svg width={size} height={size} style={{ display: "block" }}>
        {/* grid rings */}
        {Array.from({ length: 4 }).map((_, k) => {
          const rr = ((k + 1) / 4) * r;
          return (
            <circle
              key={k}
              cx={cx}
              cy={cy}
              r={rr}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
            />
          );
        })}

        {/* axes */}
        {axisPts.map((p, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="rgba(255,255,255,0.10)"
          />
        ))}

        {/* dominated thin gray polygons */}
        <g opacity={dominatedOpacity}>
          {dominatedPaths.map((d, idx) => (
            <path
              key={idx}
              d={d}
              fill="none"
              stroke={dominatedStroke}
              strokeWidth={dominatedStrokeWidth}
            />
          ))}
        </g>

        {/* skyline polygons (thick colored) */}
        {skylineSeries.map((s) => (
          <g key={s.id}>
            <path
              d={s.path}
              fill={s.color}
              opacity={skylineFillOpacity}
              stroke="none"
            />
            <path
              d={s.path}
              fill="none"
              stroke={s.color}
              strokeWidth={skylineStrokeWidth}
            />
          </g>
        ))}

        {/* axis labels */}
        {showAxisLabels &&
          axisPts.map((p, i) => {
            const a = attributes[i];
            const label = a.label ?? a.key;

            // Simple label alignment strategy: offset based on quadrant
            const dx = (p.x - cx) * 0.06;
            const dy = (p.y - cy) * 0.06;

            let anchor: "start" | "middle" | "end" = "middle";
            if (Math.abs(p.x - cx) > 1e-3) anchor = p.x > cx ? "start" : "end";

            return (
              <text
                key={a.key}
                x={p.x + dx}
                y={p.y + dy}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={9}
                fill="rgba(226,232,240,0.85)"
              >
                {label}
              </text>
            );
          })}
      </svg>
    </div>
  );
}