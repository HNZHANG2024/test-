import React from "react";

type AttributeConfig = {
  key: string;
  label: string;
  min?: number;
  max?: number;
};

type RadarChartProps = {
  player: any;
  attributes: AttributeConfig[];
  size?: number;
  color?: string;
  domScore?: number;
  maxDomScoreGlobal?: number;
  showDistribution?: boolean;

  // Fig.6b
  rankings?: Record<string, number[]>;
  showRanking?: boolean;
  showAttrValue?: boolean;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function norm(val: number, min?: number, max?: number) {
  if (typeof val !== "number" || Number.isNaN(val)) return 0;
  if (min === undefined || max === undefined || max === min) return clamp01(val);
  return clamp01((val - min) / (max - min));
}

function gaussian(u: number) {
  return Math.exp(-0.5 * u * u);
}

// Silverman bandwidth
function bandwidthSilverman(samples: number[]) {
  const n = samples.length;
  if (n < 2) return 1;

  let mean = 0;
  for (const x of samples) mean += x;
  mean /= n;

  let v = 0;
  for (const x of samples) v += (x - mean) * (x - mean);
  v /= (n - 1);

  const s = Math.sqrt(v);
  return Math.max(1e-6, 1.06 * s * Math.pow(n, -0.2));
}

// KDE on [min,max] sampled at m points
function kdeGaussian(samples: number[], min: number, max: number, m: number) {
  const ys = new Array(m).fill(0);
  const n = samples.length;
  if (n === 0) return { ys };

  const h = bandwidthSilverman(samples);
  const inv = 1 / (n * h);

  for (let i = 0; i < m; i++) {
    const x = min + (i / (m - 1)) * (max - min);
    let sum = 0;
    for (let j = 0; j < n; j++) sum += gaussian((x - samples[j]) / h);
    ys[i] = sum * inv;
  }

  // normalize to [0,1]
  let maxY = 0;
  for (const y of ys) if (y > maxY) maxY = y;
  if (maxY < 1e-12) maxY = 1;
  for (let i = 0; i < m; i++) ys[i] /= maxY;

  return { ys };
}

function bisectLeft(sorted: number[], x: number) {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// IMPORTANT: rankings[key] MUST be sorted ascending for bisectLeft to work.
function getRankRatioLocal(
  rankings: Record<string, number[]> | undefined,
  key: string,
  val: number
) {
  const arr = rankings?.[key];
  if (!arr || arr.length < 2 || typeof val !== "number" || Number.isNaN(val)) return 0;
  const idx = bisectLeft(arr, val);
  return clamp01(idx / (arr.length - 1));
}

export default function RadarChart({
  player,
  attributes,
  size = 120,
  color = "#a855f7",
  domScore = 0,
  maxDomScoreGlobal = 1,
  showDistribution = false,
  rankings,
  showRanking = false,
  showAttrValue = false,
}: RadarChartProps) {
  const r = size / 2;
  const cx = r;
  const cy = r;
  const ringCount = 4;
  const axisLen = r * 0.85;

  // Precompute geometry so polygon + markers align perfectly.
  const nodes = attributes.map((attr, i) => {
    const a = (i / attributes.length) * Math.PI * 2 - Math.PI / 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);

    const val = player?.[attr.key];
    const vNorm = norm(val, attr.min, attr.max);

    // Rank ratio -> marker radius (paper-style)
    const rankRatio = showRanking ? getRankRatioLocal(rankings, attr.key, val) : 0;
    const t = clamp01(rankRatio);
    const rMin = 2.5;
    const rMax = 7.0;
    const rankR = rMin + (rMax - rMin) * Math.sqrt(t);

    const rr = vNorm * axisLen;
    const x = cx + ux * rr;
    const y = cy + uy * rr;

    return { attr, ux, uy, x, y, rankR };
  });

  // Polygon points from the same coords used by markers
  const pts = nodes.map((n) => `${n.x},${n.y}`).join(" ");

  // Dominating score circle radius
  const blueR = clamp01(domScore / Math.max(1e-6, maxDomScoreGlobal)) * (r * 0.18);

  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {/* rings */}
      {Array.from({ length: ringCount }).map((_, k) => {
        const rr = ((k + 1) / ringCount) * axisLen;
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

      {/* axes + distributions (background only) */}
      {nodes.map((n) => {
        const { attr, ux, uy } = n;
        const px = -uy;
        const py = ux;
        const dist = rankings?.[attr.key];

        return (
          <g key={attr.key}>
            {/* Distribution (Fig.6b) */}
            {showDistribution && dist && dist.length > 0 && (() => {
              let lo = attr.min;
              let hi = attr.max;

              // fallback: compute from dist
              if (lo === undefined || hi === undefined || hi <= lo) {
                lo = Infinity;
                hi = -Infinity;
                for (const x of dist) {
                  if (x < lo!) lo = x;
                  if (x > hi!) hi = x;
                }
                if (!isFinite(lo!) || !isFinite(hi!) || hi! <= lo!) return null;
              }

              const m = 48;
              const { ys } = kdeGaussian(dist, lo!, hi!, m);

              const left: string[] = [];
              const right: string[] = [];
              const maxWidth = 8;

              for (let i = 0; i < m; i++) {
                const t = i / (m - 1);
                const rr = t * axisLen;
                const w = ys[i] * maxWidth;

                const x = cx + ux * rr;
                const y = cy + uy * rr;

                left.push(`${x - px * w},${y - py * w}`);
                right.push(`${x + px * w},${y + py * w}`);
              }

              const dPath = `M ${left.join(" L ")} L ${right.reverse().join(" L ")} Z`;
              return (
                <path
                  d={dPath}
                  fill="rgba(148,163,184,0.18)"
                  stroke="rgba(148,163,184,0.28)"
                  strokeWidth={1}
                />
              );
            })()}

            {/* axis */}
            <line
              x1={cx}
              y1={cy}
              x2={cx + ux * axisLen}
              y2={cy + uy * axisLen}
              stroke="rgba(255,255,255,0.12)"
            />

            {/* axis end cap */}
            <circle
              cx={cx + ux * axisLen}
              cy={cy + uy * axisLen}
              r={2}
              fill="rgba(255,255,255,0.35)"
            />
          </g>
        );
      })}

      {/* polygon (main shape) */}
      <polygon
        points={pts}
        fill={color}
        fillOpacity={0.25}
        stroke={color}
        strokeOpacity={0.8}
      />

      {/* ranking markers ON vertices (solid, paper-style) */}
      {showRanking &&
        nodes.map((n) => (
          <circle
            key={`rank-${n.attr.key}`}
            cx={n.x}
            cy={n.y}
            r={n.rankR}
            fill={color}
            stroke="rgba(15,23,42,0.9)"
            strokeWidth={1}
            opacity={0.98}
          />
        ))}

      {/* optional: attr.value crisp dot on top of ranking marker */}
      {showAttrValue &&
        nodes.map((n) => (
          <circle
            key={`val-${n.attr.key}`}
            cx={n.x}
            cy={n.y}
            r={2.0}
            fill="rgba(226,232,240,0.90)"
            opacity={0.95}
          />
        ))}

      {/* dominating score circle */}
      <circle
        cx={cx}
        cy={cy}
        r={blueR}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={2}
        opacity={0.9}
      />

      {/* center dot */}
      <circle cx={cx} cy={cy} r={2} fill="rgba(255,255,255,0.6)" />
    </svg>
  );
}
