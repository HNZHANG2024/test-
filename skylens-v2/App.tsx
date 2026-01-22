import React, { useState, useEffect, useMemo } from 'react';
import { fetchLocalData } from './services/dataService';
import { computeSkylineCPU } from './services/skylineService';
import { computeSkylineWebGPU } from './services/webgpuService';
import ProjectionView from './components/ProjectionView';
import TabularView from './components/TabularView';
import ComparisonView from './components/ComparisonView';
import QueryModifier from './components/QueryModifier';
import { DataPoint, AttributeConfig, SkylineResult, ComputeMode, FilterConfig } from './types';
import { Layers, Activity, Trash2, Database } from 'lucide-react';

const App = () => {
  const [computeMode, setComputeMode] = useState<ComputeMode>('CPU');
  const [gpuAvailable, setGpuAvailable] = useState<boolean>(true);

  const [fullData, setFullData] = useState<DataPoint[]>([]); 
  const [dataLimit, setDataLimit] = useState<number>(100); 
  const [attributes, setAttributes] = useState<AttributeConfig[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeAttributes, setActiveAttributes] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  
  const [isComputing, setIsComputing] = useState<boolean>(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [skylineResult, setSkylineResult] = useState<SkylineResult>({
      skylineIds: new Set(),
      dominanceScores: {},
      dominatedBy: {},
      computationTime: 0,
      method: 'CPU'
  });

  const filteredData = useMemo(() => {
    let result = fullData.slice(0, dataLimit);
    filters.forEach(f => {
        result = result.filter(d => {
            const val = d[f.attribute] as number;
            return f.operator === '<' ? val >= f.value : val <= f.value;
        });
    });
    return result;
  }, [fullData, dataLimit, filters]);

  useEffect(() => {
    if (!(navigator as any).gpu) {
        setGpuAvailable(false);
        setComputeMode('CPU');
    }
  }, []);
  
  useEffect(() => {
    const loadData = async () => {
        setIsComputing(true);
        try {
            const { data: localData, attributes: localAttrs } = await fetchLocalData(`${import.meta.env.BASE_URL}data/male_players.csv`);
            if (localData && localData.length > 0) {
                setFullData(localData);
                setAttributes(localAttrs);
                setActiveAttributes(localAttrs.slice(0, 6).map(a => a.key));
            }
        } catch (e) {
            console.error("Failed to load player data.");
        } finally {
            setSelectedIds([]);
            setIsComputing(false);
        }
    };
    loadData();
  }, []);

  useEffect(() => {
    const compute = async () => {
        if (filteredData.length === 0 || activeAttributes.length === 0) return;
        setIsComputing(true);
        const orderedActiveAttrs = activeAttributes.map(key => attributes.find(a => a.key === key)!).filter(Boolean);
        
        setTimeout(async () => {
            try {
                let result: SkylineResult;
                if (computeMode === 'WebGPU' && gpuAvailable) {
                    result = await computeSkylineWebGPU(filteredData, orderedActiveAttrs);
                } else {
                    result = computeSkylineCPU(filteredData, orderedActiveAttrs);
                }
                setSkylineResult(result);
            } catch (e) {
                console.error("Computation failed", e);
            } finally {
                setIsComputing(false);
            }
        }, 50);
    };
    compute();
  }, [filteredData, activeAttributes, computeMode]);

  const MAX_SELECTED = 4;

  const handleSelection = (id: string) => {
  setSelectedIds(prev => {
    if (prev.includes(id)) return prev.filter(p => p !== id);
    if (prev.length >= MAX_SELECTED) return prev;   // Do not add more than MAX_SELECTED
    return [...prev, id];
  });
};

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const toggleAttribute = (key: string) => {
    setActiveAttributes(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const filteredAttrs = useMemo(() => {
    return attributes.filter(a => activeAttributes.includes(a.key));
  }, [attributes, activeAttributes]);

  return (
    <div className="w-screen h-screen bg-slate-950 flex flex-col text-slate-200 overflow-hidden font-sans">
      <header className="h-10 border-b border-slate-800 bg-slate-900/50 flex items-center px-6 justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center gap-3">
            <Layers className="text-blue-500" size={18} />
            <h1 className="text-lg font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent tracking-tight">SkyLens</h1>
        </div>

        <div className="flex items-center gap-4">
            {selectedIds.length > 0 && (
                <button onClick={clearSelection} className="flex items-center gap-2 px-3 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded text-red-400 text-[10px] font-bold transition-all">
                    <Trash2 size={12} /> CLEAR ({selectedIds.length})
                </button>
            )}
            
            <div className="flex items-center gap-2 bg-slate-950 p-1 rounded border border-slate-800">
                <button onClick={() => setComputeMode('CPU')} className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${computeMode === 'CPU' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>CPU</button>
                <button onClick={() => setComputeMode('WebGPU')} disabled={!gpuAvailable} className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${computeMode === 'WebGPU' ? 'bg-blue-600 text-white' : 'text-slate-500 disabled:opacity-30'}`}>WebGPU</button>
            </div>

            <div className={`flex items-center gap-2 px-3 py-1 rounded border ${isComputing ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}>
                <Activity size={12} className={isComputing ? 'animate-pulse' : ''} />
                <span className="text-[10px] font-mono">{skylineResult.computationTime.toFixed(1)}ms</span>
            </div>
        </div>
      </header>

      <main className="flex-1 p-3 grid grid-cols-12 grid-rows-12 gap-3 min-h-0 overflow-hidden">
        <div className="col-span-5 row-span-6 min-h-0">
            <ProjectionView 
                data={filteredData} 
                attributes={filteredAttrs} 
                skylineResult={skylineResult} 
                selectedIds={selectedIds} 
                hoveredId={hoveredId}
                onSelect={handleSelection} 
                onHover={setHoveredId}
            />
        </div>

        <div className="col-span-4 row-span-6 min-h-0">
            <ComparisonView 
                data={filteredData} 
                attributes={filteredAttrs} 
                skylineResult={skylineResult} 
                selectedIds={selectedIds}
                onHover={setHoveredId}
            />
        </div>

        <div className="col-span-3 row-span-6 flex flex-col gap-3 min-h-0">
            <QueryModifier 
                attributes={attributes} 
                filters={filters} 
                onFiltersChange={setFilters} 
            />

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow-lg min-h-0">
                <div className="p-3 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <Database size={14} className="text-slate-500" />
                        <h3 className="text-[10px] uppercase font-black tracking-widest text-slate-400">Attribute Table</h3>
                    </div>
                </div>

                <div className="p-3 space-y-4 shrink-0">
                    <div className="space-y-2">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-500">
                            <span>Data Limit</span>
                            <span className="text-blue-400">{dataLimit}</span>
                        </div>
                        <input type="range" min="100" max="5000" step="100" value={dataLimit} onChange={(e) => setDataLimit(Number(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    </div>
                </div>

                <div className="flex-1 overflow-auto scrollbar-thin">
                    <table className="w-full text-[9px] text-left border-collapse">
                        <thead className="sticky top-0 bg-slate-900 shadow-sm z-10">
                            <tr className="text-slate-500 font-black uppercase">
                                <th className="p-2 border-b border-slate-800">Attr</th>
                                <th className="p-2 border-b border-slate-800 text-center">Active</th>
                                <th className="p-2 border-b border-slate-800 text-right">Range</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {attributes.map((attr) => (
                                <tr key={attr.key} className="hover:bg-slate-800/50">
                                    <td className="p-2 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: attr.color }} />
                                        <span className="font-bold text-slate-300 truncate max-w-[80px]">{attr.label}</span>
                                    </td>
                                    <td className="p-2 text-center">
                                        <input type="checkbox" checked={activeAttributes.includes(attr.key)} onChange={() => toggleAttribute(attr.key)} className="rounded border-slate-700 bg-slate-950 text-blue-500 focus:ring-0" />
                                    </td>
                                    <td className="p-2 text-right font-mono text-slate-500">
                                        {attr.min}-{attr.max}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div className="col-span-12 row-span-6 min-h-0">
            <TabularView 
                data={filteredData} 
                attributes={filteredAttrs} 
                skylineResult={skylineResult} 
                selectedIds={selectedIds} 
                hoveredId={hoveredId}
                onSelect={handleSelection} 
                onHover={setHoveredId}
            />
        </div>
      </main>
    </div>
  );
};

export default App;