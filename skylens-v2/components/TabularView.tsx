import React, { useMemo, useState, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { DataPoint, AttributeConfig, SkylineResult } from '../types';
import { Search, CheckCircle2, ChevronDown, X, Trash2, FilterX } from 'lucide-react';

interface Props {
  data: DataPoint[];
  attributes: AttributeConfig[];
  skylineResult: SkylineResult;
  selectedIds: string[]; // [0] is the Expanded/Primary player
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onClearSelection?: () => void;
}

const COL_WIDTH = 140; 
const NAME_COL_WIDTH = 160; 
const ROW_HEIGHT = 40;

// --- Helper: Calculate Decisive Subspaces ---
// Finds 2D attribute pairs where the target point is NOT dominated by anyone else
const getDecisiveSubspaces = (
  target: DataPoint, 
  allPoints: DataPoint[], 
  attributes: AttributeConfig[]
): number[][] => {
  const decisiveIndices: number[][] = [];
  
  // Check all pairs of attributes (2D subspaces)
  for (let i = 0; i < attributes.length; i++) {
    for (let j = i + 1; j < attributes.length; j++) {
      const attrA = attributes[i];
      const attrB = attributes[j];
      
      // Check if ANY point dominates 'target' in this specific 2D subspace
      const isDominatedInSubspace = allPoints.some(other => {
        if (other.id === target.id) return false;
        
        const aValT = target[attrA.key] as number;
        const bValT = target[attrB.key] as number;
        const aValO = other[attrA.key] as number;
        const bValO = other[attrB.key] as number;

        // Dominated if other is better/equal in both AND strictly better in at least one
        const betterOrEqualA = aValO >= aValT;
        const betterOrEqualB = bValO >= bValT;
        const strictlyBetter = aValO > aValT || bValO > bValT;

        return betterOrEqualA && betterOrEqualB && strictlyBetter;
      });

      if (!isDominatedInSubspace) {
        decisiveIndices.push([i, j]);
      }
    }
  }
  // Return top 5 to avoid overflow
  return decisiveIndices.slice(0, 5);
};


// --- Sub-Components ---

// 1. Header with Histogram & Brushing
const HeaderDistribution: React.FC<{ 
    attr: AttributeConfig, 
    allData: DataPoint[], 
    skylineData: DataPoint[],
    filterRange: [number, number] | null,
    onFilter: (range: [number, number] | null) => void 
}> = ({ attr, allData, skylineData, filterRange, onFilter }) => {
    const PADDING = 8;
    const width = COL_WIDTH - (PADDING * 2);
    const height = 50;
    const brushRef = useRef<SVGGElement>(null);

    const x = useMemo(() => d3.scaleLinear().domain([attr.min, attr.max]).range([0, width]), [attr, width]);
    
    const histogram = useMemo(() => {
        const values = allData.map(d => d[attr.key] as number);
        return d3.bin().domain([attr.min, attr.max]).thresholds(30)(values);
    }, [allData, attr]);
    
    const y = d3.scaleLinear().domain([0, d3.max(histogram, d => d.length) || 1]).range([height, 0]);

    // D3 Brush Implementation
    useEffect(() => {
        if (!brushRef.current) return;

        const brush = d3.brushX()
            .extent([[0, 0], [width, height]])
            .on("end", (event) => {
                if (!event.selection) {
                    onFilter(null);
                    return;
                }
                const [x0, x1] = event.selection;
                const val0 = x.invert(x0);
                const val1 = x.invert(x1);
                onFilter([val0, val1]);
            });

        const brushGroup = d3.select(brushRef.current);
        brushGroup.call(brush as any);

        if (filterRange === null) {
            brushGroup.call(brush.move as any, null);
        }
    }, [width, height, onFilter, x, filterRange]);

    return (
        <div className="flex flex-col items-center w-full group relative">
            <span className="text-[10px] font-black uppercase mb-1" style={{ color: attr.color }}>{attr.label}</span>
            <svg width={width} height={height} className="overflow-visible">
                {/* Histogram Bars */}
                {histogram.map((bin, i) => (
                    <rect 
                        key={i}
                        x={x(bin.x0 || 0)}
                        y={y(bin.length)}
                        width={Math.max(1, x(bin.x1 || 0) - x(bin.x0 || 0))}
                        height={height - y(bin.length)}
                        fill="#64748b"
                        fillOpacity="0.3"
                    />
                ))}
                
                {/* Red markers for Skyline points in header */}
                {skylineData.map((d, i) => (
                    <line 
                        key={i} 
                        x1={x(d[attr.key] as number)} 
                        y1={height - 8} 
                        x2={x(d[attr.key] as number)} 
                        y2={height} 
                        stroke="#ef4444" 
                        strokeWidth="1.5" 
                        opacity="0.7" 
                    />
                ))}

                <g ref={brushRef} className="brush-layer" />
            </svg>
        </div>
    );
};

// 2. Diverging Bar Cell
const DivergingBarCell: React.FC<{
    point: DataPoint;
    attr: AttributeConfig;
    sortedPoints: DataPoint[];
    stats: Record<string, { mean: number; std: number }>;
    otherAttrs: AttributeConfig[];
    isHovered: boolean;
    isExpanded: boolean;
}> = ({ point, attr, sortedPoints, stats, otherAttrs, isHovered, isExpanded }) => {
    const PADDING = 8;
    const colWidth = COL_WIDTH - (PADDING * 2);
    const height = ROW_HEIGHT - 4;
    const barWidth = colWidth / Math.max(1, sortedPoints.length);
    const baseline = height / 2;
    
    return (
        <svg width={colWidth} height={height} className="overflow-visible">
            <line x1={0} y1={baseline} x2={colWidth} y2={baseline} stroke="#475569" strokeWidth="1" />
            {sortedPoints.map((p, idx) => {
                const isSelf = p.id === point.id;
                let sumDelta = 0;
                otherAttrs.forEach(oa => {
                    const stat = stats[oa.key];
                    const delta = ((point[oa.key] as number) - (p[oa.key] as number)) / (stat.std || 1);
                    sumDelta += delta;
                });
                const maxDelta = 3;
                const barHeight = Math.min(baseline - 2, Math.abs(sumDelta) / maxDelta * (baseline - 2));
                const barY = sumDelta > 0 ? baseline - barHeight : baseline;
                
                let fillColor = '#3b82f6'; // Blue
                if (sumDelta < 0) fillColor = '#ef4444'; // Red
                if (isSelf) fillColor = '#a855f7'; // Purple
                
                return <rect 
                    key={p.id} 
                    x={idx * barWidth} 
                    y={barY} 
                    width={Math.max(1, barWidth - 0.5)} 
                    height={Math.max(1, barHeight)} 
                    fill={fillColor} 
                    opacity={isSelf ? 1 : (isHovered || isExpanded ? 0.7 : 0.5)} 
                />;
            })}
        </svg>
    );
};

// 3. Comparison Matrix
const ComparisonMatrix: React.FC<{ targetPoint: DataPoint, otherPoints: DataPoint[], attributes: AttributeConfig[], stats: Record<string, { mean: number, std: number }> }> = ({ targetPoint, otherPoints, attributes, stats }) => {
    const cellHeight = 10;
    const filteredOthers = otherPoints.filter(p => p.id !== targetPoint.id);
    const sortedOthersByAttr = useMemo(() => {
        const out: Record<string, DataPoint[]> = {};
        for (const colAttr of attributes) {
            out[colAttr.key] = [...filteredOthers].sort(
                (a, b) => (a[colAttr.key] as number) - (b[colAttr.key] as number)
            );
        }
        return out;
    }, [filteredOthers, attributes]);
    const matrixHeight = attributes.length * cellHeight;
    return (
        <div className="flex">
            {attributes.map((colAttr) => {
                const PADDING = 8;
                const colWidth = COL_WIDTH - (PADDING * 2);
                const sortedOthers = sortedOthersByAttr[colAttr.key] || [];
                const cellWidth = colWidth / sortedOthers.length;
                return (
                    <div key={colAttr.key} style={{ width: `${COL_WIDTH}px` }} className="px-1 flex justify-center">
                        <svg width={colWidth} height={matrixHeight}>
                            {attributes.map((rowAttr, rowIdx) => {
                                const rowY = rowIdx * cellHeight;
                                return (
                                    <g key={rowAttr.key}>
                                        {sortedOthers.map((otherPoint, playerIdx) => {
                                            const diff = ((otherPoint[rowAttr.key] as number) - (targetPoint[rowAttr.key] as number)) / (stats[rowAttr.key].std || 1);
                                            const color = diff > 0 ? '#3b82f6' : '#ef4444';
                                            return <rect 
                                                key={`${rowAttr.key}-${otherPoint.id}`} 
                                                x={playerIdx * cellWidth} 
                                                y={rowY} 
                                                width={Math.max(1, cellWidth - 0.5)} 
                                                height={cellHeight - 1} 
                                                fill={color} 
                                                fillOpacity={Math.min(0.9, Math.abs(diff) / 2.5)} 
                                            />;
                                        })}
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                );
            })}
        </div>
    );
};

// 4. Decisive Subspaces Visualization
const DecisiveSubspaces: React.FC<{ attributes: AttributeConfig[], subspaces: number[][] }> = ({ attributes, subspaces }) => {
    const cellHeight = 8;
    const height = attributes.length * cellHeight;
    return (
        <div className="flex w-full h-full pr-4">
            <div className="flex flex-col items-end mr-2 flex-1">
                {attributes.map((attr) => (
                    <div key={attr.key} className="text-[7px] text-slate-500 uppercase truncate" style={{ height: `${cellHeight}px`, lineHeight: `${cellHeight}px` }}>{attr.label}</div>
                ))}
            </div>
            <svg width={subspaces.length * 10 + 5} height={height}>
                {subspaces.map((subspace, sIdx) => (
                    <g key={sIdx} transform={`translate(${sIdx * 10 + 2}, 0)`}>
                        <line x1={0} y1={0} x2={0} y2={height} stroke="#334155" strokeWidth="1" />
                        {subspace.map(attrIdx => <rect key={attrIdx} x={-2} y={attrIdx * cellHeight + 1} width={4} height={cellHeight - 2} fill="#a855f7" rx={1} />)}
                    </g>
                ))}
            </svg>
        </div>
    );
};

// --- Main Component ---

const TabularView: React.FC<Props> = ({ 
    data, attributes, skylineResult, selectedIds, hoveredId, onSelect, onHover, onClearSelection 
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<'all' | 'selected'>('all');
    const [filters, setFilters] = useState<Record<string, [number, number]>>({});
    
    // Search Dominance State
    const [searchDominators, setSearchDominators] = useState<string[] | null>(null);
    const [searchStatus, setSearchStatus] = useState<'none' | 'skyline' | 'dominated'>('none');

    // Scroll Tracking
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [scrollTick, setScrollTick] = useState(0);
    const scrollRafRef = useRef<number | null>(null);

    // DOM measurement refs for stable linking geometry
    const headerRef = useRef<HTMLDivElement>(null);
    const expandedRowBarsRef = useRef<HTMLDivElement | null>(null);

    // Measured viewport Y values
    const headerBottomYRef = useRef(0);
    const expandedRowTopYRef = useRef(0);

    const handleScroll = () => {
        if (scrollRafRef.current != null) return;

        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;

            const h = headerRef.current;
            const r = expandedRowBarsRef.current;
            if (h && r) {
            headerBottomYRef.current = h.getBoundingClientRect().bottom;
            expandedRowTopYRef.current = r.getBoundingClientRect().top;
            }

            setScrollTick(t => t + 1);
        });
        };

    useEffect(() => {
    const measure = () => {
        const h = headerRef.current;
        const r = expandedRowBarsRef.current;
        if (!h || !r) return;

        headerBottomYRef.current = h.getBoundingClientRect().bottom;
        expandedRowTopYRef.current = r.getBoundingClientRect().top;
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    }, [selectedIds?.[0], attributes.length]);

    const skylinePoints = useMemo(() => {
        return data.filter(p => skylineResult.skylineIds.has(p.id));
    }, [data, skylineResult]);
    
    // Precompute per-attribute sorting once (avoid per-cell sort)
    const sortedSkylineByAttr = useMemo(() => {
        const out: Record<string, DataPoint[]> = {};
        for (const attr of attributes) {
            out[attr.key] = [...skylinePoints].sort(
                (a, b) => (a[attr.key] as number) - (b[attr.key] as number)
            );
        }
        return out;
    }, [skylinePoints, attributes]);

    // Precompute rank index lookup (id -> sorted index) for O(1) selfIndex
    const skylineRankIndexByAttr = useMemo(() => {
        const out: Record<string, Record<string, number>> = {};
        for (const attr of attributes) {
            const arr = sortedSkylineByAttr[attr.key] || [];
            const m: Record<string, number> = {};
            for (let i = 0; i < arr.length; i++) m[arr[i].id] = i;
            out[attr.key] = m;
        }
        return out;
    }, [sortedSkylineByAttr, attributes]);

    // Handle Searching Logic (Dominance Check)
    useEffect(() => {
        if (!searchTerm) {
            setSearchDominators(null);
            setSearchStatus('none');
            return;
        }

        const foundPoint = data.find(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
        
        if (foundPoint) {
            if (skylineResult.skylineIds.has(foundPoint.id)) {
                // Point is in Skyline
                setSearchStatus('skyline');
                setSearchDominators([foundPoint.id]);
            } else {
                // Point is NOT in Skyline -> Find Dominators
                setSearchStatus('dominated');
                const dominators = skylinePoints.filter(sPoint => {
                    let isBetterOrEqual = true;
                    let isStrictlyBetter = false;
                    attributes.forEach(attr => {
                        for (let k = 0; k < attributes.length; k++) {
                            const key = attributes[k].key;
                            const sVal = sPoint[key] as number;
                            const pVal = foundPoint[key] as number;
                            if (sVal < pVal) { isBetterOrEqual = false; break; }
                            if (sVal > pVal) { isStrictlyBetter = true; }
                        }
                    });
                    return isBetterOrEqual && isStrictlyBetter;
                });
                setSearchDominators(dominators.map(d => d.id));
            }
        } else {
            setSearchStatus('none');
            setSearchDominators(null);
        }
    }, [searchTerm, data, skylineResult, skylinePoints, attributes]);

    const MAX_SELECTED = 4;
    const displayedRows = useMemo(() => {
        let rows = [...skylinePoints];

        // 1) Apply Filters
        if (viewMode === 'selected') {
            rows = rows.filter(p => selectedIds.includes(p.id));
        }

        // 2) Pin selected to top
        rows.sort((a, b) => {
            const indexA = selectedIds.indexOf(a.id);
            const indexB = selectedIds.indexOf(b.id);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return (skylineResult.dominanceScores[b.id] || 0) - (skylineResult.dominanceScores[a.id] || 0);
        });

        // 3) over 4 selected: only show selected
        if (selectedIds.length >= MAX_SELECTED) {
            return rows.filter(p => selectedIds.includes(p.id)); // Only show selected
        }

        // 4) Normal browsing when less than 4 selected (originally all mode shows up to 50)
        return viewMode === 'all' ? rows.slice(0, 50) : rows;
        }, [skylinePoints, selectedIds, viewMode, skylineResult]);

    const stats = useMemo(() => {
        const res: Record<string, { mean: number, std: number }> = {};
        attributes.forEach(attr => {
            const vals = data.map(d => d[attr.key] as number);
            res[attr.key] = { mean: d3.mean(vals) || 0, std: d3.deviation(vals) || 1 };
        });
        return res;
    }, [data, attributes]);

    const handleFilterChange = (key: string, range: [number, number] | null) => {
        setFilters(prev => {
            const next = { ...prev };
            if (range) next[key] = range;
            else delete next[key];
            return next;
        });
    };

    const handleUnselect = (e: React.MouseEvent, id: string) => {
        e.stopPropagation(); 
        onSelect(id); 
    };

    return (
        <div className="w-full h-full flex flex-col bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
            {/* Header Controls */}
            <div className="p-2 border-b border-slate-800 bg-slate-800/50 flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-2">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tabular View</h3>
                    
                    <div className="flex bg-slate-950 rounded p-0.5 border border-slate-700">
                        <button onClick={() => setViewMode('all')} className={`px-2 py-0.5 text-[9px] rounded ${viewMode === 'all' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>All</button>
                        <button onClick={() => setViewMode('selected')} disabled={selectedIds.length === 0} className={`px-2 py-0.5 text-[9px] rounded flex items-center gap-1 ${viewMode === 'selected' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>
                            <CheckCircle2 size={10} /> Selected
                        </button>
                    </div>

                    {Object.keys(filters).length > 0 && (
                        <button 
                            onClick={() => setFilters({})} 
                            className="flex items-center gap-1 px-2 py-1 text-[9px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors ml-2"
                        >
                            <FilterX size={10} /> Reset Filters
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {searchStatus === 'dominated' && (
                        <span className="text-[9px] text-amber-500 font-bold px-2 bg-amber-500/10 rounded border border-amber-500/20">
                            Dominated: Showing superiors
                        </span>
                    )}

                    <div className="relative w-32">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" size={10} />
                        <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded py-1 pl-6 pr-2 text-[9px] text-slate-300 focus:outline-none focus:border-blue-500" />
                    </div>
                </div>
            </div>
            
            {/* Main Scroll Container */}
            <div 
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-auto"
            >
                <div className="relative min-w-fit">
                    {/* Sticky Headers */}
                    <div ref={headerRef} className="sticky top-0 z-20 bg-slate-900 border-b border-slate-800 shadow-lg">
                        <div className="flex">
                            <div style={{ width: NAME_COL_WIDTH }} className="shrink-0 p-2 border-r border-slate-800">
                                <span className="text-[9px] font-bold text-slate-500 uppercase">Player</span>
                            </div>
                            <div className="flex">
                                {attributes.map(attr => (
                                    <div key={attr.key} style={{ width: `${COL_WIDTH}px` }} className="p-2">
                                        <HeaderDistribution 
                                            attr={attr} 
                                            allData={data} 
                                            skylineData={skylinePoints} 
                                            filterRange={filters[attr.key] || null}
                                            onFilter={(range) => handleFilterChange(attr.key, range)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    {/* Data Rows */}
                    {displayedRows.map((point, rowIndex) => {
                        const isSelected = selectedIds.includes(point.id);
                        const isHovered = hoveredId === point.id;
                        const isExpanded = selectedIds.length > 0 && selectedIds[0] === point.id;
                        
                        // Check if point meets active brush filters
                        let isFilteredOut = false;
                        for (const [key, range] of Object.entries(filters)) {
                            const val = point[key] as number;
                            if (val < range[0] || val > range[1]) {
                                isFilteredOut = true;
                                break;
                            }
                        }

                        // Search Highlighting
                        const isSearchHighlighted = searchDominators?.includes(point.id);

                        // yEnd is the header-bottom Y relative to the expanded row bar-area top.
                        const measuredYEnd =
                            headerBottomYRef.current && expandedRowTopYRef.current
                                ? headerBottomYRef.current - expandedRowTopYRef.current
                                : 0;

                        const yStart = ROW_HEIGHT / 2;
                        const yEnd = Math.max(-200, Math.min(200, measuredYEnd));


                        // Calculate unique subspaces for THIS point
                        const calculatedSubspaces = isExpanded
                            ? getDecisiveSubspaces(point, skylinePoints, attributes)
                            : [];

                        return (
                            <div 
                                key={point.id} 
                                className={`border-b border-slate-800/30 transition-all duration-300 ${isFilteredOut ? 'opacity-30 grayscale' : 'opacity-100'}`}
                            >
                                <div 
                                    onClick={() => onSelect(point.id)}
                                    onMouseEnter={() => onHover(point.id)}
                                    onMouseLeave={() => onHover(null)}
                                    className={`flex cursor-pointer relative ${
                                        isSearchHighlighted ? 'bg-amber-900/20' : 
                                        isSelected ? 'bg-slate-800/80' : 
                                        'hover:bg-slate-800/30'
                                    }`}
                                    style={{ height: `${ROW_HEIGHT}px` }}
                                >
                                    {/* Name Column */}
                                    <div style={{ width: NAME_COL_WIDTH }} className="shrink-0 px-3 py-2 border-r border-slate-800/50 flex items-center gap-2 relative">
                                        {isExpanded && <ChevronDown size={12} className="text-blue-400 absolute left-1" />}
                                        <div className="flex-1 min-w-0 pl-2">
                                            <div className={`text-[11px] font-bold truncate ${
                                                isSearchHighlighted ? 'text-amber-400' :
                                                isSelected ? 'text-blue-400' : 
                                                'text-slate-300'
                                            }`}>
                                                {point.name}
                                            </div>
                                            <div className="text-[8px] text-slate-600 font-mono">{point.id.slice(0, 6)}</div>
                                        </div>
                                        {isSelected && (
                                            <button 
                                                onClick={(e) => handleUnselect(e, point.id)}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white hover:bg-slate-700 rounded-full transition-colors z-20"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                    
                                    {/* Bar Charts Area */}
                                    <div
                                        className="flex flex-1 relative"
                                        ref={(el) => {
                                            if (isExpanded) expandedRowBarsRef.current = el;
                                        }}
                                    >
                                        {attributes.map(attr => (
                                            <div key={attr.key} style={{ width: `${COL_WIDTH}px` }} className="px-1 flex items-center justify-center">
                                                <DivergingBarCell
                                                    point={point}
                                                    attr={attr}
                                                    sortedPoints={sortedSkylineByAttr[attr.key] || []}
                                                    stats={stats}
                                                    otherAttrs={attributes.filter(a => a.key !== attr.key)}
                                                    isHovered={isHovered}
                                                    isExpanded={isExpanded}
                                                />
                                            </div>
                                        ))}
                                        
                                        {/* Linking Curve Overlay (Red Line) */}
                                        {isExpanded && (
                                            <svg className="absolute top-0 left-0 pointer-events-none overflow-visible" width="100%" height={ROW_HEIGHT} style={{ zIndex: 100 }}>
                                                {attributes.map((attr, colIdx) => {
                                                    const PADDING = 8;
                                                    const drawWidth = COL_WIDTH - (PADDING * 2);
                                                    const colStart = colIdx * COL_WIDTH + PADDING;
                                                    
                                                    const sortedPoints = sortedSkylineByAttr[attr.key] || [];
                                                    const selfIndex = skylineRankIndexByAttr[attr.key]?.[point.id] ?? -1;
                                                    if (selfIndex < 0) return null;
                                                    
                                                    const barWidth = drawWidth / sortedPoints.length;
                                                    const startX = colStart + (selfIndex * barWidth) + (barWidth / 2);
                                                    
                                                    const headerScale = d3.scaleLinear().domain([attr.min, attr.max]).range([0, drawWidth]);
                                                    const valueX = colStart + headerScale(point[attr.key] as number);
                                                    
                                                    const yStart = ROW_HEIGHT / 2; 
                                                    const yEnd = measuredYEnd; 
                                                    
                                                    return (
                                                        <g key={attr.key}>
                                                            <path 
                                                                d={`M ${startX},${yStart} C ${startX},${yStart - 25} ${valueX},${yEnd + 25} ${valueX},${yEnd}`} 
                                                                stroke="#ef4444" 
                                                                strokeWidth="2" 
                                                                fill="none" 
                                                                opacity="0.9" 
                                                            />
                                                            <circle cx={startX} cy={yStart} r={3} fill="#ef4444" />
                                                        </g>
                                                    );
                                                })}
                                            </svg>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Expansion Details (Subspaces & Matrix) */}
                                {isExpanded && (
                                    <div className="bg-slate-950/50 border-b border-slate-800 flex shadow-inner">
                                            <div style={{ width: NAME_COL_WIDTH }} className="shrink-0 p-3 border-r border-slate-800/50 flex flex-col justify-center">
                                                <div className="text-[7px] text-slate-500 font-bold uppercase tracking-wider mb-2">Decisive Subspaces</div>
                                                <DecisiveSubspaces attributes={attributes} subspaces={calculatedSubspaces} />
                                            </div>
                                            <div className="flex-1 py-3 bg-slate-950/30">
                                                <div className="px-2 mb-1 text-[7px] text-slate-600 uppercase font-bold tracking-wider">Detailed Matrix</div>
                                                <ComparisonMatrix targetPoint={point} otherPoints={skylinePoints} attributes={attributes} stats={stats} />
                                            </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default TabularView;