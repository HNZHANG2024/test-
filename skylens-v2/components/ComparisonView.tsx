import React, { useMemo, useEffect, useRef, useState } from 'react';
import RadarChart from "./RadarChart";
import DominancePopup from "./DominancePopup";
import * as d3 from 'd3';
import { DataPoint, AttributeConfig, SkylineResult } from '../types';
import { Users, Activity } from 'lucide-react';

interface Props {
  data: DataPoint[];
  attributes: AttributeConfig[];
  skylineResult: SkylineResult;
  selectedIds: string[];
  onHover: (id: string | null) => void;
  onHighlight?: (ids: Set<string> | null) => void; // bar/table highlighting
}

interface ComparisonNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'RADAR' | 'GLYPH';
  color?: string;

  // GLYPH only
  subsetIds?: string[];
  dominatedPointIds?: string[];

  // pinned for RADAR
  fx?: number;
  fy?: number;
}

type LinkDatum = d3.SimulationLinkDatum<ComparisonNode> & {
  source: ComparisonNode | string;
  target: ComparisonNode | string;
};

type DomSet = { id: string; set: Set<string> };

type Subset = {
  ids: string[];
  unionSize: number;
  dominatedPointIds: string[];
  exclusivePointIds: Record<string, string[]>;
  exclusiveCounts: Record<string, number>;
  exclusiveShares: Record<string, number>;
  pieValues: Record<string, number>;
};


const PLAYER_COLORS = ['#a855f7', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const ComparisonView: React.FC<Props> = ({ data, attributes, skylineResult, selectedIds, onHover, onHighlight }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<ComparisonNode[]>([]);
  const [links, setLinks] = useState<LinkDatum[]>([]);

  const [hoverInfo, setHoverInfo] = useState<{
    player: DataPoint;
    x: number;
    y: number;
  } | null>(null);

  const [pairPopup, setPairPopup] = useState<{
    skylinePoints: DataPoint[];
    dominatedPoints: DataPoint[];
    x: number;
    y: number;
    focusId: string;
  } | null>(null);

  const dataById = useMemo(() => {
    const m = new Map<string, DataPoint>();
    data.forEach(d => m.set(d.id, d));
    return m;
  }, [data]);



  // colors for selected players
  const playerColors = useMemo(() => {
    const map: Record<string, string> = {};
    selectedIds.forEach((id, i) => {
      map[id] = PLAYER_COLORS[i % PLAYER_COLORS.length];
    });
    return map;
  }, [selectedIds]);

  const selectedPlayers = useMemo(() => {
    return selectedIds.slice(0, 4).map(id => data.find(p => p.id === id)).filter(Boolean) as DataPoint[];
  }, [selectedIds, data]);

  const contextAverage = useMemo(() => {
    const avg: Record<string, number> = {};
    attributes.forEach(attr => {
      avg[attr.key] = d3.mean(data, d => d[attr.key] as number) ?? 0;
    });
    return avg;
  }, [data, attributes]);

  const attributeRankings = useMemo(() => {
    const ranks: Record<string, number[]> = {};
    attributes.forEach(attr => {
      ranks[attr.key] = data.map(d => (d[attr.key] as number) ?? attr.min).sort((a, b) => a - b);
    });
    return ranks;
  }, [data, attributes]);

  const getRankRatio = (key: string, val: number) => {
    const sorted = attributeRankings[key];
    if (!sorted || sorted.length === 0) return 0;
    const idx = d3.bisectLeft(sorted, val);
    const ratio = idx / Math.max(1, sorted.length - 1);
    return clamp01(ratio);
  };

  // dominance check: assumes "higher is better" already unified upstream
  const checkDomination = (a: DataPoint, b: DataPoint) => {
    let strictlyBetter = false;
    for (const attr of attributes) {
      const va = (a[attr.key] as number) ?? attr.min;
      const vb = (b[attr.key] as number) ?? attr.min;
      if (va < vb) return false;
      if (va > vb) strictlyBetter = true;
    }
    return strictlyBetter;
  };

  /**
   * Build domination sets for selectedPlayers:
   * domSet[sid] = Set of all points dominated by skyline point sid
   */
  const domSets = useMemo<DomSet[]>(() => {
    if (selectedPlayers.length === 0 || attributes.length === 0) return [];
    return selectedPlayers.map(p => {
      const set = new Set<string>();
      for (const target of data) {
        if (checkDomination(p, target)) set.add(target.id);
      }
      return { id: p.id, set };
    });
  }, [selectedPlayers, data, attributes]);

  /**
   * subsets: all combos (size 2..n) that have non-empty UNION dominated set.
   * For each combo:
   *  - unionSize = |⋃ domSet|
   *  - dominatedPointIds = union IDs (for hover popups later if you want)
   *  - exclusiveCountsWithinCombo[id] = |dom(id) - ⋃ others|
   *  - exclusiveShares[id] = exclusiveCountsWithinCombo[id] / unionSize
   */

  
  const subsets = useMemo<Subset[]>(() => {
    if (selectedPlayers.length < 2 || attributes.length === 0) return [];

    const domSetMap = new Map<string, Set<string>>();
    domSets.forEach(ds => domSetMap.set(ds.id, ds.set));

    const results: Subset[] = [];

    const getCombinations = <T,>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      const f = (start: number, prev: T[]) => {
        if (prev.length === size) { out.push(prev); return; }
        for (let i = start; i < arr.length; i++) f(i + 1, [...prev, arr[i]]);
      };
      f(0, []);
      return out;
    };


    // precompute dominating scores (for pie)
    const pieValuesAll: Record<string, number> = {};
    domSets.forEach(ds => {
      // prefer skylineResult score if present, fallback to computed dominated set size
      pieValuesAll[ds.id] = skylineResult.dominanceScores[ds.id] ?? ds.set.size;
    });

    for (let s = 2; s <= selectedPlayers.length; s++) {
      const combos: DomSet[][] = getCombinations<DomSet>(domSets, s);
      for (const combo of combos) {
        const ids = combo.map(c => c.id);

        // UNION
        const union = new Set<string>();
        combo.forEach(c => c.set.forEach(x => union.add(x)));
        const unionSize = union.size;
        if (unionSize === 0) continue;

        const unionIds = Array.from(union);

        // exclusivePointIds
        const exclusivePointIds: Record<string, string[]> = {};
        ids.forEach(id => (exclusivePointIds[id] = []));

        for (const pid of unionIds) {
          const owners = ids.filter(id => domSetMap.get(id)?.has(pid));
          if (owners.length === 1) {
            exclusivePointIds[owners[0]].push(pid);
          }
        }

        // counts/shares
        const exclusiveCounts: Record<string, number> = {};
        const exclusiveShares: Record<string, number> = {};
        ids.forEach(id => {
          const c = exclusivePointIds[id].length;
          exclusiveCounts[id] = c;
          exclusiveShares[id] = c / Math.max(1, unionSize);
        });

        const pieValues: Record<string, number> = {};
        ids.forEach(id => {
          pieValues[id] = pieValuesAll[id] ?? 0;
        });

        results.push({
          ids,
          unionSize,
          dominatedPointIds: Array.from(union),
          exclusivePointIds,
          exclusiveCounts,
          exclusiveShares,
          pieValues,
        });
      }
    }

    return results;
  }, [selectedPlayers, attributes.length, domSets, skylineResult.dominanceScores]);

  // used to scale glyph radii within current view
  const maxUnionInView = useMemo(() => {
    return Math.max(1, ...subsets.map(s => s.unionSize));
  }, [subsets]);

  const openDominancePopup = (e: React.MouseEvent, combo: Subset, focusId: string) => {
    if (combo.ids.length !== 2) return;

    const skylinePoints = combo.ids
      .map(id => selectedPlayers.find(p => p.id === id))
      .filter(Boolean) as DataPoint[];

    const exIds = combo.exclusivePointIds?.[focusId] ?? [];
    const dominatedPoints = exIds
      .map(id => dataById.get(id))
      .filter(Boolean) as DataPoint[];

    setPairPopup({
      skylinePoints,
      dominatedPoints,
      x: e.clientX,
      y: e.clientY,
      focusId,
    });

    onHover(focusId);
    onHighlight?.(new Set(exIds));
  };

  const closeDominancePopup = () => {
    setPairPopup(null);
    onHover(null);
    onHighlight?.(null);
  };

  useEffect(() => {
    if (selectedPlayers.length < 1) {
      setNodes([]);
      setLinks([]);
      return;
    }

    const width = containerRef.current?.clientWidth || 400;
    const height = containerRef.current?.clientHeight || 400;
    const cx = width / 2;
    const cy = height / 2;
    const outerR = Math.min(width, height) * 0.35;

    const radarNodes: ComparisonNode[] = selectedPlayers.map((p, i) => {
      const angle = (i / selectedPlayers.length) * 2 * Math.PI - Math.PI / 2;
      return {
        id: p.id,
        type: 'RADAR',
        color: playerColors[p.id],
        fx: cx + Math.cos(angle) * outerR,
        fy: cy + Math.sin(angle) * outerR,
      };
    });

    const glyphNodes: ComparisonNode[] = subsets.map((s, i) => ({
      id: `glyph-${s.ids.join('-')}`,
      type: 'GLYPH',
      subsetIds: s.ids,
      dominatedPointIds: s.dominatedPointIds,
      x: cx + (Math.random() - 0.5) * 60,
      y: cy + (Math.random() - 0.5) * 60,
    }));

    const allNodes: ComparisonNode[] = [...radarNodes, ...glyphNodes];

    const linkData: LinkDatum[] = glyphNodes.flatMap(g =>
      (g.subsetIds ?? []).map(sid => ({
        source: sid,
        target: g.id,
      })) as LinkDatum[]
    );

    const sim = d3.forceSimulation<ComparisonNode>(allNodes)
      .force("link", d3.forceLink<ComparisonNode, LinkDatum>(linkData)
        .id((d: any) => d.id)
        .distance(70)
        .strength(0.35)
      )
      .force("charge", d3.forceManyBody().strength(-240))
      .force("center", d3.forceCenter(cx, cy))
      .force("collide", d3.forceCollide<ComparisonNode>(d => (d.type === 'RADAR' ? 60 : 40)).iterations(2))
      .alphaDecay(0.06)
      .velocityDecay(0.45);

    // Throttle state updates to animation frames (keeps React from dying)
    let raf = 0;
    const tick = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setNodes([...allNodes]);
        setLinks([...linkData]);
      });
    };

    sim.on("tick", tick);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      sim.stop();
    };
  }, [selectedPlayers, subsets, playerColors]);

  if (selectedPlayers.length === 0) {
    return (
      <div className="w-full h-full bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-800 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-14 h-14 bg-slate-800/80 rounded-full flex items-center justify-center mb-4 border border-slate-700 shadow-2xl">
          <Users className="text-slate-500" size={24} />
        </div>
        <h3 className="text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] mb-2">Comparison View</h3>
        <p className="text-slate-600 text-[9px] max-w-[150px]">Select players from Table or Projection to compare performance</p>
      </div>
    );
  }

  const maxDomScoreGlobal = Math.max(1, ...Object.values(skylineResult.dominanceScores) as number[]);

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden">
      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <filter id="glow-colored">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-blue">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Connecting Links */}
        {links.map((lk, i) => {
          const s = lk.source as any;
          const t = lk.target as any;
          if (s?.x == null || s?.y == null || t?.x == null || t?.y == null) return null;
          return (
            <line
              key={i}
              x1={s.x} y1={s.y}
              x2={t.x} y2={t.y}
              stroke="#1e293b"
              strokeWidth="2"
              strokeDasharray="5,3"
              opacity="0.6"
            />
          );
        })}

        {nodes.map(node => {
          if (node.type === 'RADAR') {
            const player = selectedPlayers.find(p => p.id === node.id)!;
            const rSize = 45;
            const radarColor = node.color || '#3b82f6';
            const domScore = skylineResult.dominanceScores[player.id] || 0;
            const blueCircleRadius = (domScore / maxDomScoreGlobal) * 16;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x ?? node.fx ?? 0}, ${node.y ?? node.fy ?? 0})`}
                onMouseEnter={(e) => {
                  onHover(node.id);
                  setHoverInfo({ player, x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  setHoverInfo((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
                }}
                onMouseLeave={() => {
                  onHover(null);
                  setHoverInfo(null);
                }}
                className="cursor-pointer"
              >
                {/* Background Grid */}
                {[0.2, 0.4, 0.6, 0.8, 1.0].map(r => (
                  <circle key={r} r={rSize * r} fill="none" stroke="#1e293b" strokeWidth="0.5" />
                ))}

                {/* Global Average Polygon */}
                {attributes.length > 0 && (
                  <polygon
                    points={attributes.map((attr, i) => {
                      const angle = (i / attributes.length) * 2 * Math.PI - Math.PI / 2;
                      const val = contextAverage[attr.key];
                      const norm = clamp01((val - attr.min) / Math.max(1, attr.max - attr.min));
                      const rr = norm * rSize;
                      return `${Math.cos(angle) * rr},${Math.sin(angle) * rr}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#475569"
                    strokeWidth="1"
                    strokeDasharray="3,2"
                    opacity="0.8"
                  />
                )}

                {/* Player Polygon */}
                {attributes.length > 0 && (
                  <polygon
                    points={attributes.map((attr, i) => {
                      const angle = (i / attributes.length) * 2 * Math.PI - Math.PI / 2;
                      const val = (player[attr.key] as number) ?? attr.min;
                      const norm = clamp01((val - attr.min) / Math.max(1, attr.max - attr.min));
                      const rr = norm * rSize;
                      return `${Math.cos(angle) * rr},${Math.sin(angle) * rr}`;
                    }).join(' ')}
                    fill={radarColor}
                    fillOpacity="0.35"
                    stroke={radarColor}
                    strokeWidth="3"
                    filter="url(#glow-colored)"
                  />
                )}

                {/* Axes + rank dots + labels */}
                {attributes.map((attr, i) => {
                  const angle = (i / attributes.length) * 2 * Math.PI - Math.PI / 2;
                  const val = (player[attr.key] as number) ?? attr.min;
                  const rankRatio = getRankRatio(attr.key, val);
                  const rx = Math.cos(angle) * (rankRatio * rSize);
                  const ry = Math.sin(angle) * (rankRatio * rSize);
                  const labelRadius = rSize + 12;
                  return (
                    <g key={attr.key}>
                      <line x1="0" y1="0" x2={Math.cos(angle) * rSize} y2={Math.sin(angle) * rSize} stroke="#334155" strokeWidth="0.5" />
                      {/* <circle cx={rx} cy={ry} r="3" fill={radarColor} stroke="white" strokeWidth="0.5" /> */}
                      <text
                        x={Math.cos(angle) * labelRadius}
                        y={Math.sin(angle) * labelRadius}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#64748b"
                        fontSize="6"
                        fontWeight="black"
                        className="uppercase"
                      >
                        {attr.label.substring(0, 3)}
                      </text>
                    </g>
                  );
                })}

                {/* Domination Score Ring */}
                <circle r={blueCircleRadius} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeOpacity="0.7" filter="url(#glow-blue)" />
                <circle r={blueCircleRadius} fill="#3b82f6" fillOpacity="0.05" />

                <text
                  y={rSize + 28}
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="10"
                  fontWeight="black"
                  className="uppercase tracking-widest drop-shadow-lg"
                >
                  {player.name.split(' ').pop()}
                </text>
              </g>
            );
          }

          // GLYPH
          const combo = subsets.find(s => `glyph-${s.ids.join('-')}` === node.id);
          if (!combo) return null;

          const baseR = 14;
          const scale = combo.unionSize / maxUnionInView;
          const comboR = baseR + scale * 18;
          const outerArcInner = comboR + 2;
          const outerArcOuter = comboR + 7;

          // inner pie weighted by dominanceScores
          const pie = d3.pie<string>()
            .value(id => combo.pieValues[id] ?? 0)
            .sort(null)(combo.ids);

          const arcGen = d3.arc<d3.PieArcDatum<string>>()
            .innerRadius(0)
            .outerRadius(comboR);

          // outer arcs: exclusive dominance (restricted inside each slice)
          const outerArcGen = d3.arc<d3.PieArcDatum<string>>()
            .innerRadius(outerArcInner)
            .outerRadius(outerArcOuter);

          return (
            <g
              key={node.id}
              transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
              className="drop-shadow-2xl"
            >
              {/* main pie */}
              {pie.map((p, i) => {
                const id = p.data;
                const fill = playerColors[id] ?? '#94a3b8';
                return (
                  <path
                    key={`pie-${i}`}
                    d={arcGen(p) || ""}
                    fill={fill}
                    fillOpacity="0.92"
                    stroke="#0f172a"
                    strokeWidth="1"
                    onMouseEnter={(e) => openDominancePopup(e, combo, id)}
                    onMouseMove={(e) => {
                      setPairPopup(pp => (pp ? { ...pp, x: e.clientX, y: e.clientY } : pp));
                    }}
                    onMouseLeave={closeDominancePopup}
                    style={{ cursor: combo.ids.length === 2 ? "pointer" : "default" }}
                  />
                );
              })}

              {/* exclusive arcs (clamped within slice) */}
              {pie.map((p, i) => {
                const id = p.data;
                const fill = playerColors[id] ?? '#94a3b8';
                const exShare = combo.exclusiveShares[id] ?? 0;

                // simplest stable behavior: cap arc to slice span.
                const sliceSpan = p.endAngle - p.startAngle;
                const arcSpan = sliceSpan * clamp01(exShare * combo.ids.length);
                const start = p.startAngle;
                const end = Math.min(p.endAngle, start + arcSpan);

                if (end <= start + 1e-4) return null;

                const patched = { ...p, startAngle: start, endAngle: end };
                return (
                  <path
                    key={`ex-${i}`}
                    d={outerArcGen(patched as any) || ""}
                    fill={fill}
                    fillOpacity="0.85"
                    stroke="#0f172a"
                    strokeWidth="0.8"
                    onMouseEnter={(e) => openDominancePopup(e, combo, id)}
                    onMouseMove={(e) => {
                      setPairPopup(pp => (pp ? { ...pp, x: e.clientX, y: e.clientY } : pp));
                    }}
                    onMouseLeave={closeDominancePopup}
                    style={{ cursor: combo.ids.length === 2 ? "pointer" : "default" }}
                  />
                );
              })}

              <circle r={comboR} fill="none" stroke="#94a3b8" strokeWidth="0.6" strokeOpacity="0.25" />

              <text
                dy=".35em"
                textAnchor="middle"
                fill="white"
                fontSize="9"
                fontWeight="black"
                pointerEvents="none"
                className="drop-shadow-sm"
              >
                {combo.unionSize}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Dominance Popup (Fig.6c) */}
      {pairPopup && (
        <DominancePopup
          x={pairPopup.x}
          y={pairPopup.y}
          skylinePoints={pairPopup.skylinePoints}
          dominatedPoints={pairPopup.dominatedPoints}
          attributes={attributes}
          colors={playerColors}
          title="Domination Comparison"
          subtitle="Thick: skyline points · Thin gray: exclusively dominated points"
          size={260}
        />
      )}

      {/* Hover pop-up (Fig.6b minimal) */}
      {hoverInfo && !pairPopup && (
        <div
          style={{
            position: "fixed",
            left: hoverInfo.x + 12,
            top: hoverInfo.y + 12,
            width: 300,
            padding: 10,
            borderRadius: 12,
            background: "rgba(10,15,25,0.95)",
            border: "1px solid rgba(255,255,255,0.12)",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.8 }}>Details</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#f8fafc" }}>
            {(hoverInfo.player.name ?? hoverInfo.player.id ?? "Selected").toString()}
          </div>

          <RadarChart
            player={hoverInfo.player}
            attributes={attributes}
            size={240}
            color={playerColors[hoverInfo.player.id] ?? "#a855f7"}
            domScore={skylineResult.dominanceScores[hoverInfo.player.id] ?? 0}
            maxDomScoreGlobal={maxDomScoreGlobal}
            rankings={attributeRankings}   //  distribution + ranking
            showDistribution={true}
            showRanking={true}
            showAttrValue={true}
          />
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-700 backdrop-blur-md shadow-2xl">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={12} className="text-blue-400" />
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Markers</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]"></div>
              <span className="text-[7px] text-slate-500 font-bold uppercase">Domination Score</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 border-t border-slate-600 border-dashed"></div>
              <span className="text-[7px] text-slate-500 font-bold uppercase">Global Average</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border border-slate-500 bg-slate-500/20"></div>
              <span className="text-[7px] text-slate-500 font-bold uppercase">Union Size</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-1.5 bg-slate-300/30 rounded"></div>
              <span className="text-[7px] text-slate-500 font-bold uppercase">Exclusive Share</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComparisonView;