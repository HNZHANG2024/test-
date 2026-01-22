import { DataPoint, AttributeConfig, SkylineResult } from '../types';
import * as d3 from 'd3';

/**
 * Determine if a dominates b (Academic definition: a is no worse than b in all dimensions, and strictly better in at least one)
 */
const dominates = (a: DataPoint, b: DataPoint, attributes: AttributeConfig[]): boolean => {
  let betterInAtLeastOne = false;
  for (const attr of attributes) {
    const valA = (a[attr.key] as number) || 0;
    const valB = (b[attr.key] as number) || 0;
    
    if (valA < valB) {
      // If A is worse than B in any dimension, A cannot dominate B
      return false;
    }
    if (valA > valB) {
      betterInAtLeastOne = true;
    }
  }
  return betterInAtLeastOne;
};

/**
 * Restore original O(N^2) nested loop algorithm
 */
export const computeSkylineCPU = (data: DataPoint[], attributes: AttributeConfig[]): SkylineResult => {
  if (data.length === 0) return { skylineIds: new Set(), dominanceScores: {}, dominatedBy: {}, computationTime: 0, method: 'CPU' };
  
  const start = performance.now();
  const n = data.length;
  
  const skylineIds = new Set<string>();
  const dominanceScores: Record<string, number> = {};
  const dominatedBy: Record<string, number> = {};

  // Initialize counters
  data.forEach(p => { 
    dominanceScores[p.id] = 0; 
    dominatedBy[p.id] = 0; 
  });

  // O(N^2) complete scan logic
  for (let i = 0; i < n; i++) {
    const a = data[i];
    let isADominated = false;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = data[j];

      // If B dominates A
      if (dominates(b, a, attributes)) {
        isADominated = true;
        dominatedBy[a.id]++;
      }

      // If A dominates B (used for Dominance Score calculation)
      if (dominates(a, b, attributes)) {
        dominanceScores[a.id]++;
      }
    }

    // Academic definition: a point belongs to the skyline if it is not dominated by any other point
    if (!isADominated) {
      skylineIds.add(a.id);
    }
  }

  const end = performance.now();
  
  return { 
    skylineIds, 
    dominanceScores, 
    dominatedBy, 
    computationTime: end - start, 
    method: 'CPU' 
  };
};

/**
 * ColorMapND Integration (Cheng et al., 2018)
 * Maps high-dimensional attributes to CIE-HCL color space.
 * 1. Arrange attribute angles on ICD (Initial Circular Distribution).
 * 2. Calculate Hue based on attribute vector superposition.
 * 3. Use attribute strength to determine Chroma.
 * 4. Keep Luminance constant for perceptual uniformity.
 */
export const computeColorMapND = (point: DataPoint, attributes: AttributeConfig[]): string => {
  if (attributes.length === 0) return '#475569';
  
  let x = 0, y = 0;
  let totalNorm = 0;
  
  attributes.forEach(attr => {
    const val = (point[attr.key] as number) || 0;
    const norm = (val - attr.min) / Math.max(1, attr.max - attr.min);
    
    // Vector superposition based on ICD angles
    x += Math.cos(attr.angle) * norm;
    y += Math.sin(attr.angle) * norm;
    totalNorm += norm;
  });

  if (totalNorm < 0.01) return d3.hcl(0, 0, 30).toString(); // Very low values are displayed as dark gray

  const angle = Math.atan2(y, x);
  const hue = (angle * 180 / Math.PI + 360) % 360;
  
  // Map strength to chroma to ensure distinctness
  const strength = Math.sqrt(x*x + y*y) / Math.sqrt(attributes.length);
  const chroma = 30 + strength * 60;
  const luminance = 60;

  return d3.hcl(hue, chroma, luminance).toString();
};
