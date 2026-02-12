import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NoteType } from '../types';
import { computeGraphLayout, SemanticGraphResult } from '../utils/semanticGraph';

interface ThoughtGraphViewProps {
  graph: SemanticGraphResult;
  includeArchived: boolean;
  minScore: number;
  focusedNoteId: string | null;
  onIncludeArchivedChange: (next: boolean) => void;
  onMinScoreChange: (next: number) => void;
  onFocusNote: (noteId: string) => void;
  onOpenNote: (noteId: string) => void;
}

interface TransformState {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.45;
const MAX_SCALE = 2.4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function typeColor(type: NoteType | undefined): string {
  if (type === NoteType.TASK) return '#10b981';
  if (type === NoteType.IDEA) return '#f59e0b';
  return '#06b6d4';
}

function chipsForEdge(edge: { tags: string[]; entities: string[]; concepts: string[] }): string[] {
  const chips: string[] = [];
  if (edge.tags.length > 0) chips.push(`Tag: ${edge.tags[0]}`);
  if (edge.entities.length > 0) chips.push(`Entity: ${edge.entities[0]}`);
  if (edge.concepts.length > 0) chips.push(`Concept: ${edge.concepts[0]}`);
  return chips;
}

const ThoughtGraphView: React.FC<ThoughtGraphViewProps> = ({
  graph,
  includeArchived,
  minScore,
  focusedNoteId,
  onIncludeArchivedChange,
  onMinScoreChange,
  onFocusNote,
  onOpenNote,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ width: 960, height: 620 });
  const [transform, setTransform] = useState<TransformState>({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setViewport({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(260, Math.floor(rect.height)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const nodeById = useMemo(() => new Map(graph.nodes.map(node => [node.id, node] as const)), [graph.nodes]);

  const effectiveFocusId = useMemo(() => {
    if (focusedNoteId && nodeById.has(focusedNoteId)) return focusedNoteId;
    return graph.nodes[0]?.id || null;
  }, [focusedNoteId, graph.nodes, nodeById]);

  useEffect(() => {
    if (!effectiveFocusId) return;
    if (focusedNoteId === effectiveFocusId) return;
    onFocusNote(effectiveFocusId);
  }, [effectiveFocusId, focusedNoteId, onFocusNote]);

  const layout = useMemo(() => computeGraphLayout(graph, viewport), [graph, viewport]);
  const focusedNode = effectiveFocusId ? nodeById.get(effectiveFocusId) || null : null;
  const focusedEdges = useMemo(
    () => (effectiveFocusId ? graph.adjacencyByNoteId.get(effectiveFocusId) || [] : []),
    [effectiveFocusId, graph.adjacencyByNoteId]
  );
  const focusedNeighborSet = useMemo(() => {
    const neighbors = new Set<string>();
    for (const edge of focusedEdges) {
      neighbors.add(edge.source === effectiveFocusId ? edge.target : edge.source);
    }
    return neighbors;
  }, [effectiveFocusId, focusedEdges]);

  const fitGraph = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    setTransform(prev => {
      const delta = event.deltaY < 0 ? 1.09 : 0.91;
      const nextScale = clamp(prev.scale * delta, MIN_SCALE, MAX_SCALE);
      const worldX = (cursorX - prev.x) / prev.scale;
      const worldY = (cursorY - prev.y) / prev.scale;
      return {
        scale: nextScale,
        x: cursorX - worldX * nextScale,
        y: cursorY - worldY * nextScale,
      };
    });
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: transform.x,
      startY: transform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [transform.x, transform.y]);

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.originX;
    const dy = event.clientY - dragState.originY;
    setTransform(prev => ({
      ...prev,
      x: dragState.startX + dx,
      y: dragState.startY + dy,
    }));
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const hasEdges = graph.edges.length > 0;
  const onlyNode = graph.nodes.length === 1 ? graph.nodes[0] : null;

  return (
    <section className="mission-note rounded-2xl border p-4 sm:p-5" data-testid="thought-graph-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl leading-none text-zinc-700 dark:text-zinc-200">Thought Graph</h3>
          <p className="mt-1 text-[11px] mission-muted uppercase tracking-wide" data-testid="graph-stats">
            {graph.stats.nodeCount} nodes · {graph.stats.edgeCount} edges · density {graph.stats.density}
          </p>
        </div>
        <button
          onClick={fitGraph}
          className="mission-tag-chip rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200"
        >
          Fit graph
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200/70 px-3 py-2 dark:border-zinc-700/70">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={e => onIncludeArchivedChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300"
              data-testid="graph-include-archived"
            />
            Include archived
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <span>Min edge score</span>
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={minScore}
              onChange={e => onMinScoreChange(Number(e.target.value))}
              className="w-32"
              data-testid="graph-min-score"
            />
            <span className="w-5 text-right">{minScore}</span>
          </label>
        </div>

        {graph.nodes.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200/70 p-6 text-center dark:border-zinc-700/70">
            <p className="text-sm mission-muted">No notes available for graph exploration yet.</p>
          </div>
        ) : onlyNode ? (
          <div className="rounded-2xl border border-zinc-200/70 p-6 dark:border-zinc-700/70">
            <p className="text-sm mission-muted">Add more notes to build semantic links.</p>
            <div className="mt-4 rounded-xl border border-zinc-200/70 p-4 dark:border-zinc-700/70">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Only node</p>
              <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{onlyNode.title}</p>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">{onlyNode.content}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <div
                ref={viewportRef}
                className="relative h-[56vh] min-h-[380px] overflow-hidden rounded-2xl border border-zinc-200/70 bg-zinc-50/40 dark:border-zinc-700/70 dark:bg-zinc-900/20"
              >
                {!hasEdges && (
                  <div className="absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    No edges at current threshold
                  </div>
                )}

                <svg
                  ref={svgRef}
                  width={viewport.width}
                  height={viewport.height}
                  className="h-full w-full touch-none select-none"
                  onWheel={handleWheel}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  aria-label="Thought graph canvas"
                >
                  <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                    {graph.edges.map(edge => {
                      const source = layout.get(edge.source);
                      const target = layout.get(edge.target);
                      if (!source || !target) return null;
                      const isFocused =
                        effectiveFocusId &&
                        (edge.source === effectiveFocusId || edge.target === effectiveFocusId);
                      return (
                        <line
                          key={edge.key}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          stroke={isFocused ? '#22d3ee' : '#94a3b8'}
                          strokeOpacity={isFocused ? 0.92 : 0.35}
                          strokeWidth={isFocused ? 1.8 : 1}
                        />
                      );
                    })}

                    {graph.nodes.map(node => {
                      const point = layout.get(node.id);
                      if (!point) return null;
                      const isFocused = effectiveFocusId === node.id;
                      const isNeighbor = focusedNeighborSet.has(node.id);
                      const fill = node.isArchived ? '#9ca3af' : typeColor(node.type);
                      const radius = isFocused ? 10 : isNeighbor ? 8 : 6.8;
                      const opacity = isFocused || !effectiveFocusId || isNeighbor ? 0.95 : 0.6;

                      return (
                        <g key={node.id}>
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={radius}
                            fill={fill}
                            fillOpacity={opacity}
                            stroke={isFocused ? '#111827' : '#f8fafc'}
                            strokeWidth={isFocused ? 2 : 1}
                            onClick={e => {
                              e.stopPropagation();
                              onFocusNote(node.id);
                            }}
                            onDoubleClick={e => {
                              e.stopPropagation();
                              onOpenNote(node.id);
                            }}
                            style={{ cursor: 'pointer' }}
                          />
                          <text
                            x={point.x + 10}
                            y={point.y - 9}
                            fontSize={10}
                            fill="currentColor"
                            className="text-zinc-600 dark:text-zinc-300"
                            style={{ pointerEvents: 'none', userSelect: 'none' }}
                          >
                            {node.title.length > 24 ? `${node.title.slice(0, 22)}...` : node.title}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            </div>

            <aside className="rounded-2xl border border-zinc-200/70 p-4 dark:border-zinc-700/70">
              {!focusedNode ? (
                <p className="text-sm mission-muted">Select a node to inspect relationships.</p>
              ) : (
                <>
                  <div className="mb-3">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-400">Focused note</p>
                    <h4 className="font-display text-2xl leading-none text-zinc-700 dark:text-zinc-200" data-testid="graph-focused-title">{focusedNode.title}</h4>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                      {focusedNode.content.length > 220 ? `${focusedNode.content.slice(0, 217)}...` : focusedNode.content}
                    </p>
                    {focusedNode.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {focusedNode.tags.slice(0, 6).map(tag => (
                          <span key={tag} className="text-[10px] mission-tag-chip rounded px-1.5 py-0.5 text-cyan-700 dark:text-cyan-300">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-400">Related notes</p>
                    {(graph.backlinksByNoteId.get(focusedNode.id) || []).length === 0 ? (
                      <p className="text-xs mission-muted">No related notes at this threshold.</p>
                    ) : (
                      (graph.backlinksByNoteId.get(focusedNode.id) || []).map(item => {
                        const edge = focusedEdges.find(
                          candidate =>
                            (candidate.source === focusedNode.id && candidate.target === item.noteId) ||
                            (candidate.target === focusedNode.id && candidate.source === item.noteId)
                        );
                        const reasonChips = chipsForEdge(edge?.reasons || { tags: [], entities: [], concepts: [] });
                        return (
                          <button
                            key={item.noteId}
                            onClick={() => onFocusNote(item.noteId)}
                            className="w-full rounded-lg mission-tag-chip px-2.5 py-2 text-left text-xs transition-colors hover:bg-cyan-50/70 dark:hover:bg-cyan-900/20"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-semibold text-zinc-700 dark:text-zinc-200">{item.title}</span>
                              <span className="text-[10px] text-zinc-500">{item.score}</span>
                            </div>
                            <p className="mt-1 text-[10px] text-cyan-700 dark:text-cyan-300">{item.reasonLabel}</p>
                            {reasonChips.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {reasonChips.map(chip => (
                                  <span key={chip} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                    {chip}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        )}
      </div>
    </section>
  );
};

export default React.memo(ThoughtGraphView);
