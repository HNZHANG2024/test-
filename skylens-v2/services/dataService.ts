import { DataPoint, AttributeConfig, DatasetType } from '../types';
import Papa from 'papaparse';

// FIFA Attributes (Default configuration)
const FIFA_ATTRIBUTES: AttributeConfig[] = [
  { key: 'pace', label: 'Pace', min: 40, max: 99, weight: 1, color: '#ef4444', angle: 0 },
  { key: 'shooting', label: 'Shooting', min: 30, max: 99, weight: 1, color: '#f97316', angle: 1.05 },
  { key: 'passing', label: 'Passing', min: 40, max: 99, weight: 1, color: '#eab308', angle: 2.09 },
  { key: 'dribbling', label: 'Dribbling', min: 40, max: 99, weight: 1, color: '#22c55e', angle: 3.14 },
  { key: 'defending', label: 'Defending', min: 20, max: 95, weight: 1, color: '#3b82f6', angle: 4.19 },
  { key: 'physical', label: 'Physical', min: 30, max: 95, weight: 1, color: '#a855f7', angle: 5.24 },
];

const getHSLColor = (index: number, total: number) => {
    const hue = (index / total) * 360;
    return `hsl(${hue}, 70%, 50%)`;
};

const dumpCodepoints = (s: string) =>
  Array.from(s).map(
    ch => `${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`
  ).join(" | ");

/**
 * Fetches data from a local CSV file path.
 */
export const fetchLocalData = async (
  path: string
): Promise<{ data: DataPoint[]; attributes: AttributeConfig[] }> => {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to fetch file at ${path}`);

    const buf = await response.arrayBuffer();

    // Try UTF-8 first; if it looks broken, fall back to Windows-1252
    const textUtf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);

    // Heuristic: if there are lots of replacement chars, it's probably wrong encoding
    const badness = (textUtf8.match(/\uFFFD/g) ?? []).length;
    const csvText =
      badness > 0
        ? new TextDecoder("windows-1252", { fatal: false }).decode(buf)
        : textUtf8;

    // Strip UTF-8 BOM if present
    const cleanText = csvText.replace(/^\uFEFF/, "");

    return processUploadedData(cleanText, "csv");
  } catch (error) {
    console.error("Error loading local CSV:", error);
    return { data: [], attributes: [] };
  }
};


/**
 * Common processing logic for CSV/JSON strings.
 */
export const processUploadedData = (rawText: string, fileType: 'csv' | 'json'): { data: DataPoint[], attributes: AttributeConfig[] } => {
    let rawData: any[] = [];

    if (fileType === 'json') {
        try {
            rawData = JSON.parse(rawText);
        } catch (e) {
            console.error("JSON Parse Error", e);
            return { data: [], attributes: [] };
        }
    } else {
        const result = Papa.parse(rawText, { header: true, dynamicTyping: true, skipEmptyLines: true });
        rawData = result.data;
    }

    if (!rawData || rawData.length === 0) return { data: [], attributes: [] };

    const sample = rawData[0];
    const potentialKeys = Object.keys(sample).slice(1);
    const ignoreKeys = ['id', 'name', 'label', 'category', 'date', 'desc', 'nationality', 'club', 'position',' ','age','goalkeeper'];
    
    const numericKeys = potentialKeys.filter(key => {
        if (ignoreKeys.includes(key.toLowerCase())) return false;
        return rawData.slice(0, 5).every(row => {
            const val = row[key];
            return typeof val === 'number' && !isNaN(val);
        });
    });

    if (numericKeys.length === 0) return { data: [], attributes: [] };

    const attributes: AttributeConfig[] = numericKeys.map((key, index) => {
        let min = Infinity;
        let max = -Infinity;

        rawData.forEach(row => {
            const val = Number(row[key]);
            if (val < min) min = val;
            if (val > max) max = val;
        });

        if (min === max) { max = min + 1; } 

        return {
            key,
            label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
            min,
            max,
            weight: 1,
            color: getHSLColor(index, numericKeys.length),
            angle: (index / numericKeys.length) * 2 * Math.PI
        };
    });

    const data: DataPoint[] = rawData.map((row, i) => {
        const id = row.id ? String(row.id) : `item-${i}`;
        const nameKey = potentialKeys.find(k => ['name', 'short_name', 'long_name', 'player_name', 'player', 'city'].includes(k.toLowerCase()));
        const rawName = nameKey ? String(row[nameKey]) : `Item ${i + 1}`;
  
   
        const point: DataPoint = { id, name: rawName };
        attributes.forEach(attr => {
            point[attr.key] = Number(row[attr.key]) || 0;
        });
        return point;
    });

    return { data, attributes };
};

// export const generateDataset = (type: DatasetType, count: number): { data: DataPoint[], attributes: AttributeConfig[] } => {
//   // Mock logic for synthetic datasets - omitted for brevity but kept consistent with app state
//   return { data: [], attributes: [] };
// };