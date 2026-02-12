import { Note } from '../types';

export interface SemanticGraphNode {
  id: string;
  title: string;
  content: string;
  type: Note['type'];
  tags: string[];
  isArchived: boolean;
}

export interface SemanticGraphEdge {
  key: string;
  source: string;
  target: string;
  score: number;
  reasons: {
    tags: string[];
    entities: string[];
    concepts: string[];
  };
}

export interface SemanticBacklink {
  noteId: string;
  title: string;
  score: number;
  reasonLabel: string;
}

export interface SemanticGraphResult {
  nodes: SemanticGraphNode[];
  edges: SemanticGraphEdge[];
  backlinksByNoteId: Map<string, SemanticBacklink[]>;
  adjacencyByNoteId: Map<string, SemanticGraphEdge[]>;
  stats: {
    nodeCount: number;
    edgeCount: number;
    density: number;
  };
}

const STOPWORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
]);

const MAX_CONCEPTS_PER_NOTE = 12;
const MAX_POSTING_LIST = 120;
const MAX_BACKLINKS_PER_NOTE = 5;
const MAX_EDGES_PER_NODE = 8;
const MAX_REASON_TERMS = 4;

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function clampText(text: string, max = 120): string {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function makePairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseWords(raw: string): string[] {
  const matches = raw.match(/[A-Za-z][A-Za-z0-9'-]*/g);
  if (!matches) return [];
  return matches.map(token => normalizeToken(token));
}

function extractEntities(raw: string): Set<string> {
  const entities = new Set<string>();
  const acronymMatches = raw.match(/\b[A-Z]{2,}\b/g) || [];
  for (const acronym of acronymMatches) {
    entities.add(normalizeToken(acronym));
  }

  const titleCaseMatches = raw.match(/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g) || [];
  for (const phrase of titleCaseMatches) {
    const normalized = normalizeToken(phrase);
    if (normalized.length >= 3) {
      entities.add(normalized);
    }
  }
  return entities;
}

interface NoteFeatureSet {
  id: string;
  tags: Set<string>;
  entities: Set<string>;
  conceptTf: Map<string, number>;
}

interface PairAccumulator {
  source: string;
  target: string;
  tagCount: number;
  entityCount: number;
  conceptCount: number;
  tags: Set<string>;
  entities: Set<string>;
  concepts: Set<string>;
}

function getOrInitPosting(postings: Map<string, string[]>, token: string): string[] {
  const existing = postings.get(token);
  if (existing) return existing;
  const created: string[] = [];
  postings.set(token, created);
  return created;
}

function addFeatureToken(postings: Map<string, string[]>, token: string, noteId: string): void {
  const entry = getOrInitPosting(postings, token);
  if (entry.length >= MAX_POSTING_LIST) return;
  entry.push(noteId);
}

function accumulatePairs(
  postings: Map<string, string[]>,
  kind: 'tag' | 'entity' | 'concept',
  pairMap: Map<string, PairAccumulator>
): void {
  for (const [token, noteIds] of postings) {
    if (noteIds.length < 2 || noteIds.length > MAX_POSTING_LIST) continue;
    for (let i = 0; i < noteIds.length; i++) {
      for (let j = i + 1; j < noteIds.length; j++) {
        const source = noteIds[i];
        const target = noteIds[j];
        const key = makePairKey(source, target);
        let acc = pairMap.get(key);
        if (!acc) {
          acc = {
            source: source < target ? source : target,
            target: source < target ? target : source,
            tagCount: 0,
            entityCount: 0,
            conceptCount: 0,
            tags: new Set(),
            entities: new Set(),
            concepts: new Set(),
          };
          pairMap.set(key, acc);
        }

        if (kind === 'tag') {
          acc.tagCount += 1;
          if (acc.tags.size < MAX_REASON_TERMS) acc.tags.add(token);
        } else if (kind === 'entity') {
          acc.entityCount += 1;
          if (acc.entities.size < MAX_REASON_TERMS) acc.entities.add(token);
        } else {
          acc.conceptCount += 1;
          if (acc.concepts.size < MAX_REASON_TERMS) acc.concepts.add(token);
        }
      }
    }
  }
}

function sortByScoreThenId<T extends { score: number; noteId?: string; source?: string; target?: string }>(a: T, b: T): number {
  if (b.score !== a.score) return b.score - a.score;
  const aId = a.noteId || `${a.source || ''}:${a.target || ''}`;
  const bId = b.noteId || `${b.source || ''}:${b.target || ''}`;
  return aId.localeCompare(bId);
}

function reasonLabelFromEdge(edge: SemanticGraphEdge): string {
  if (edge.reasons.tags.length > 0) return `Shared tag: ${edge.reasons.tags[0]}`;
  if (edge.reasons.entities.length > 0) return `Shared entity: ${edge.reasons.entities[0]}`;
  if (edge.reasons.concepts.length > 0) return `Shared concept: ${edge.reasons.concepts[0]}`;
  return 'Related';
}

export function buildSemanticGraph(
  notes: Note[],
  options: { includeArchived: boolean; minScore: number }
): SemanticGraphResult {
  const minScore = Number.isFinite(options.minScore) ? Math.max(1, options.minScore) : 3;
  const sourceNotes = notes.filter(note => (options.includeArchived ? true : !note.isArchived));
  const nodes: SemanticGraphNode[] = sourceNotes.map(note => ({
    id: note.id,
    title: note.title || clampText(note.content, 60) || 'Untitled note',
    content: note.content || '',
    type: note.type,
    tags: note.tags || [],
    isArchived: !!note.isArchived,
  }));

  if (nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      backlinksByNoteId: new Map(),
      adjacencyByNoteId: new Map(),
      stats: { nodeCount: 0, edgeCount: 0, density: 0 },
    };
  }

  const noteFeatureSets: NoteFeatureSet[] = [];
  const docFrequency = new Map<string, number>();

  for (const note of sourceNotes) {
    const rawText = `${note.title || ''}\n${note.content || ''}`;
    const tags = new Set((note.tags || []).map(tag => normalizeToken(tag)).filter(Boolean));
    const entities = extractEntities(rawText);
    const tf = new Map<string, number>();

    for (const word of parseWords(rawText)) {
      if (word.length < 3) continue;
      if (STOPWORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      tf.set(word, (tf.get(word) || 0) + 1);
    }

    const uniqueConcepts = new Set(tf.keys());
    for (const token of uniqueConcepts) {
      docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
    }

    noteFeatureSets.push({
      id: note.id,
      tags,
      entities,
      conceptTf: tf,
    });
  }

  const maxDfRatio = 0.4;
  const noteCount = Math.max(1, noteFeatureSets.length);
  const conceptsByNote = new Map<string, Set<string>>();

  for (const features of noteFeatureSets) {
    const weighted: Array<{ token: string; score: number }> = [];
    for (const [token, freq] of features.conceptTf) {
      const df = docFrequency.get(token) || 0;
      if (df / noteCount > maxDfRatio) continue;
      const idf = Math.log(1 + noteCount / (1 + df));
      weighted.push({ token, score: freq * idf });
    }

    weighted.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.token.localeCompare(b.token)));
    const picked = new Set(weighted.slice(0, MAX_CONCEPTS_PER_NOTE).map(item => item.token));
    conceptsByNote.set(features.id, picked);
  }

  const tagPostings = new Map<string, string[]>();
  const entityPostings = new Map<string, string[]>();
  const conceptPostings = new Map<string, string[]>();

  for (const features of noteFeatureSets) {
    for (const token of features.tags) {
      addFeatureToken(tagPostings, token, features.id);
    }
    for (const token of features.entities) {
      addFeatureToken(entityPostings, token, features.id);
    }
    for (const token of conceptsByNote.get(features.id) || []) {
      addFeatureToken(conceptPostings, token, features.id);
    }
  }

  const pairAccumulators = new Map<string, PairAccumulator>();
  accumulatePairs(tagPostings, 'tag', pairAccumulators);
  accumulatePairs(entityPostings, 'entity', pairAccumulators);
  accumulatePairs(conceptPostings, 'concept', pairAccumulators);

  const allEdges: SemanticGraphEdge[] = [];
  for (const acc of pairAccumulators.values()) {
    const tagScore = Math.min(acc.tagCount * 3, 9);
    const entityScore = Math.min(acc.entityCount * 2, 6);
    const conceptScore = Math.min(acc.conceptCount, 4);
    const score = roundTo(tagScore + entityScore + conceptScore, 2);
    if (score < minScore) continue;

    allEdges.push({
      key: makePairKey(acc.source, acc.target),
      source: acc.source,
      target: acc.target,
      score,
      reasons: {
        tags: Array.from(acc.tags.values()),
        entities: Array.from(acc.entities.values()),
        concepts: Array.from(acc.concepts.values()),
      },
    });
  }

  const edgesByNode = new Map<string, SemanticGraphEdge[]>();
  for (const edge of allEdges) {
    const sourceList = edgesByNode.get(edge.source) || [];
    sourceList.push(edge);
    edgesByNode.set(edge.source, sourceList);

    const targetList = edgesByNode.get(edge.target) || [];
    targetList.push(edge);
    edgesByNode.set(edge.target, targetList);
  }

  const selectedEdgeKeys = new Set<string>();
  for (const [nodeId, candidates] of edgesByNode) {
    const sorted = [...candidates].sort(sortByScoreThenId);
    for (const edge of sorted.slice(0, MAX_EDGES_PER_NODE)) {
      selectedEdgeKeys.add(edge.key);
    }
    if (!edgesByNode.has(nodeId)) {
      edgesByNode.set(nodeId, sorted);
    }
  }

  const edges = allEdges
    .filter(edge => selectedEdgeKeys.has(edge.key))
    .sort(sortByScoreThenId);

  const adjacencyByNoteId = new Map<string, SemanticGraphEdge[]>();
  for (const node of nodes) {
    adjacencyByNoteId.set(node.id, []);
  }
  for (const edge of edges) {
    adjacencyByNoteId.get(edge.source)?.push(edge);
    adjacencyByNoteId.get(edge.target)?.push(edge);
  }
  for (const [nodeId, list] of adjacencyByNoteId) {
    adjacencyByNoteId.set(nodeId, [...list].sort(sortByScoreThenId));
  }

  const nodeById = new Map(nodes.map(node => [node.id, node] as const));
  const backlinksByNoteId = new Map<string, SemanticBacklink[]>();
  for (const node of nodes) {
    const neighbors = adjacencyByNoteId.get(node.id) || [];
    const backlinks = neighbors
      .map(edge => {
        const noteId = edge.source === node.id ? edge.target : edge.source;
        return {
          noteId,
          title: nodeById.get(noteId)?.title || 'Untitled note',
          score: edge.score,
          reasonLabel: reasonLabelFromEdge(edge),
        };
      })
      .sort(sortByScoreThenId)
      .slice(0, MAX_BACKLINKS_PER_NOTE);
    backlinksByNoteId.set(node.id, backlinks);
  }

  const maxEdges = nodes.length <= 1 ? 1 : (nodes.length * (nodes.length - 1)) / 2;
  const density = roundTo(edges.length / maxEdges, 4);

  return {
    nodes,
    edges,
    backlinksByNoteId,
    adjacencyByNoteId,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      density,
    },
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function computeGraphLayout(
  result: SemanticGraphResult,
  viewport: { width: number; height: number }
): Map<string, { x: number; y: number }> {
  const width = Math.max(320, Math.floor(viewport.width || 0));
  const height = Math.max(240, Math.floor(viewport.height || 0));
  const centerX = width / 2;
  const centerY = height / 2;
  const minDimension = Math.min(width, height);

  const layout = new Map<string, { x: number; y: number }>();
  if (result.nodes.length === 0) return layout;
  if (result.nodes.length === 1) {
    layout.set(result.nodes[0].id, { x: centerX, y: centerY });
    return layout;
  }

  const connected: SemanticGraphNode[] = [];
  const isolated: SemanticGraphNode[] = [];
  for (const node of result.nodes) {
    const degree = result.adjacencyByNoteId.get(node.id)?.length || 0;
    if (degree > 0) connected.push(node);
    else isolated.push(node);
  }

  const sortNodes = (nodes: SemanticGraphNode[]): SemanticGraphNode[] =>
    [...nodes].sort((a, b) => {
      const aDeg = result.adjacencyByNoteId.get(a.id)?.length || 0;
      const bDeg = result.adjacencyByNoteId.get(b.id)?.length || 0;
      if (bDeg !== aDeg) return bDeg - aDeg;
      return a.id.localeCompare(b.id);
    });

  const placeRing = (nodes: SemanticGraphNode[], radiusX: number, radiusY: number, angleOffset = 0) => {
    if (nodes.length === 0) return;
    const ordered = sortNodes(nodes);
    const step = (Math.PI * 2) / ordered.length;
    for (let i = 0; i < ordered.length; i++) {
      const node = ordered[i];
      const noise = ((hashString(node.id) % 1000) / 1000 - 0.5) * 0.18;
      const angle = angleOffset + i * step + noise;
      layout.set(node.id, {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      });
    }
  };

  if (connected.length > 0) {
    placeRing(
      connected,
      minDimension * 0.28,
      minDimension * 0.22,
      (hashString(connected[0].id) % 360) * (Math.PI / 180)
    );
  }

  if (isolated.length > 0) {
    placeRing(
      isolated,
      minDimension * 0.42,
      minDimension * 0.34,
      (hashString(isolated[0].id) % 360) * (Math.PI / 180)
    );
  }

  return layout;
}
