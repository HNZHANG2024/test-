import React, { useState } from 'react';
import { AttributeConfig, FilterConfig } from '../types';
import { Plus, X, Filter } from 'lucide-react';

interface Props {
  attributes: AttributeConfig[];
  filters: FilterConfig[];
  onFiltersChange: (filters: FilterConfig[]) => void;
}

const QueryModifier: React.FC<Props> = ({ attributes, filters, onFiltersChange }) => {
  const [selectedAttr, setSelectedAttr] = useState(attributes[0]?.key || '');
  const [operator, setOperator] = useState<'<' | '>'>('<');
  const [value, setValue] = useState(0);

  const addFilter = () => {
    if (!selectedAttr) return;
    onFiltersChange([...filters, { attribute: selectedAttr, operator, value }]);
  };

  const removeFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col max-h-[200px]">
      <div className="p-3 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Filter size={14} className="text-blue-400" />
            <h3 className="text-[10px] uppercase font-black tracking-widest text-slate-400">Skyline Query Modifier</h3>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Input area */}
        <div className="flex gap-2 items-center">
            <select 
                value={selectedAttr} 
                onChange={(e) => setSelectedAttr(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded text-[9px] p-1 text-slate-300 focus:outline-none focus:border-blue-500"
            >
                {attributes.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <select 
                value={operator} 
                onChange={(e) => setOperator(e.target.value as any)}
                className="bg-slate-950 border border-slate-700 rounded text-[9px] p-1 text-slate-300 w-10 text-center"
            >
                <option value="<">&lt;</option>
                <option value=">">&gt;</option>
            </select>
            <input 
                type="number" 
                value={value} 
                onChange={(e) => setValue(Number(e.target.value))}
                className="w-12 bg-slate-950 border border-slate-700 rounded text-[9px] p-1 text-slate-300 focus:outline-none focus:border-blue-500"
            />
            <button onClick={addFilter} className="p-1 bg-blue-600 hover:bg-blue-500 rounded text-white">
                <Plus size={12} />
            </button>
        </div>

        {/* Active Filters */}
        <div className="space-y-1 overflow-y-auto max-h-[80px] scrollbar-thin">
            {filters.length === 0 && (
                <p className="text-[8px] text-slate-600 italic">No exclusion points defined.</p>
            )}
            {filters.map((f, i) => (
                <div key={i} className="flex items-center justify-between bg-slate-950 border border-slate-800 p-1.5 rounded group">
                    <span className="text-[9px] text-slate-400 font-medium">
                        Exclude points with <span className="text-blue-400 font-bold">{attributes.find(a => a.key === f.attribute)?.label}</span> {f.operator} {f.value}
                    </span>
                    <button onClick={() => removeFilter(i)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={10} />
                    </button>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default QueryModifier;