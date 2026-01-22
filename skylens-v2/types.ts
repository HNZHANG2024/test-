export interface DataPoint {
  id: string;
  name: string;
  [key: string]: string | number;
}

export interface AttributeConfig {
  key: string;
  label: string;
  min: number;
  max: number;
  weight: number;
  color: string;
  angle: number;
}

export interface FilterConfig {
  attribute: string;
  operator: '<' | '>';
  value: number;
}

export interface SkylineResult {
  skylineIds: Set<string>;
  dominanceScores: Record<string, number>;
  dominatedBy: Record<string, number>;
  computationTime: number;
  method: 'CPU' | 'WebGPU';
}

export type DatasetType = 'LOCAL_PLAYERS' | 'FIFA' | 'CITIES' | 'CUSTOM';
export type ComputeMode = 'CPU' | 'WebGPU';