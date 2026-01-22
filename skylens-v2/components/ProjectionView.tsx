import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { DataPoint, AttributeConfig, SkylineResult } from '../types';
import { computeColorMapND } from '../services/skylineService';

interface Props {
  data: DataPoint[];
  attributes: AttributeConfig[];
  skylineResult: SkylineResult;
  selectedIds: string[];
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  data: DataPoint;
  isSkyline: boolean;
  domScore: number;
  x?: number;
  y?: number;
}

const ProjectionView: React.FC<Props> = ({ data, attributes, skylineResult, selectedIds, hoveredId, onSelect, onHover }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);
  
  const selectedIdsRef = useRef(selectedIds);
  const hoveredIdRef = useRef(hoveredId);
  const attributesRef = useRef(attributes);
  const skylineResultRef = useRef(skylineResult);

  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { 
    hoveredIdRef.current = hoveredId; 
    // if (simulationRef.current) {
    //     simulationRef.current.alpha(0.01).restart();
    // }
  }, [hoveredId]);
  useEffect(() => { attributesRef.current = attributes; }, [attributes]);
  useEffect(() => { skylineResultRef.current = skylineResult; }, [skylineResult]);

  const nodes: Node[] = useMemo(() => {
    return data.map(d => ({
      id: d.id,
      name: d.name,
      data: d,
      isSkyline: skylineResult.skylineIds.has(d.id),
      domScore: skylineResult.dominanceScores[d.id] || 0
    }));
  }, [data, skylineResult.skylineIds, skylineResult.dominanceScores]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || nodes.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    if (simulationRef.current) simulationRef.current.stop();

    const simulation = d3.forceSimulation<Node>(nodes)
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("charge", d3.forceManyBody().strength(-35))
      .force("collide", d3.forceCollide<Node>(d => d.isSkyline ? 24 : 8))
      .force("x", d3.forceX(width / 2).strength(0.1))
      .force("y", d3.forceY(height / 2).strength(0.1))
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    simulationRef.current = simulation;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const colorScale = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]);

    const draw = () => {
      if (!ctx) return;
      const currentSelected = selectedIdsRef.current;
      const currentHovered = hoveredIdRef.current;
      const currentAttributes = attributesRef.current;
      const currentResult = skylineResultRef.current;
      const maxDom = Math.max(1, ...Object.values(currentResult.dominanceScores) as number[]);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      
      const t = transformRef.current;
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Background points
      nodes.forEach(node => {
        if (node.isSkyline) return;
        const isHovered = currentHovered === node.id;
        const color = computeColorMapND(node.data, currentAttributes);
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, (isHovered ? 8 : 4) / t.k, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = (currentSelected.includes(node.id) || isHovered) ? 1.0 : 0.4;
        ctx.fill();
        if (isHovered) {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2 / t.k;
            ctx.stroke();
        }
      });

      // Skyline Glyphs
      if (currentAttributes.length > 0) {
        const sectorAngle = (2 * Math.PI) / currentAttributes.length;
        const skylineNodes = nodes.filter(n => n.isSkyline);

        const sortedSkyline = skylineNodes.sort((a, b) => {
            if (a.id === currentHovered) return 1;
            if (b.id === currentHovered) return -1;
            return 0;
        });

        sortedSkyline.forEach(node => {
            const isSelected = currentSelected.includes(node.id);
            const isHovered = node.id === currentHovered;
            
            const scale = (isHovered || isSelected) ? 1.5 : 1.0;
            const baseInnerR = 6 * scale / t.k;
            const baseOuterMaxR = 18 * scale / t.k;

            ctx.save();
            ctx.translate(node.x ?? 0, node.y ?? 0);

            currentAttributes.forEach((attr, i) => {
            const val = (node.data[attr.key] as number) || 0;
            const norm = (val - attr.min) / Math.max(1, attr.max - attr.min);
            const outerR = baseInnerR + (norm * baseOuterMaxR);
            const startAngle = (i * sectorAngle) - Math.PI / 2;

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, outerR, startAngle, startAngle + sectorAngle);
            ctx.fillStyle = attr.color;
            ctx.globalAlpha = (isHovered || isSelected) ? 1.0 : 0.7;
            ctx.fill();
            });

            ctx.beginPath();
            ctx.arc(0, 0, baseInnerR, 0, 2 * Math.PI);
            ctx.fillStyle = colorScale(node.domScore / maxDom);
            ctx.globalAlpha = 1.0;
            ctx.fill();
            
            if (isSelected || isHovered) {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2 / t.k;
            ctx.stroke();
            }
            ctx.restore();
        });
      }

      ctx.restore();
    };

    simulation.on("tick", draw);
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 20])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        draw();
      });
    d3.select(canvas).call(zoom);

    return () => { simulation.stop(); };
  }, [nodes, attributes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const lastHoverIdRef = { current: null as string | null };
    const rafRef = { current: 0 as number };
    const pendingRef = { current: null as { x: number; y: number } | null };

    const getPointAt = (mx: number, my: number) => {
      const t = transformRef.current;
      const worldX = (mx - t.x) / t.k;
      const worldY = (my - t.y) / t.k;

      // use quadtree for optimization if needed
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = (n.x ?? 0) - worldX;
        const dy = (n.y ?? 0) - worldY;
        const radius = (n.isSkyline ? 20 : 8) / t.k;
        if (dx * dx + dy * dy < radius * radius) return n;
      }
      return null;
    };

    const scheduleHover = () => {
      rafRef.current = 0;
      const p = pendingRef.current;
      if (!p) return;

      const node = getPointAt(p.x, p.y);
      const nextId = (node?.id as string) || null;

      // if hoverId changes, update the hover state
      if (nextId !== lastHoverIdRef.current) {
        lastHoverIdRef.current = nextId;
        onHover(nextId);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pendingRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(scheduleHover);
      }
    };


    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const node = getPointAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node) onSelect(node.id);
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [nodes, onSelect, onHover]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 cursor-move" />
      <div className="absolute top-4 left-4 pointer-events-none z-10">
        <div className="bg-slate-900/80 border border-slate-700 p-3 rounded-xl backdrop-blur-md shadow-lg">
            <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Projection View</h3>
        </div>
      </div>
    </div>
  );
};

export default ProjectionView;
