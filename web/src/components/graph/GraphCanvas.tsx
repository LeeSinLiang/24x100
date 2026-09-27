// The Graph view's canvas (spec §0.15 P1): the lot and everything the answer rests on, drawn in SVG in
// the plat (light) and cyanotype (dark) looks from the CSS tokens. The layout is the engine's fixed
// cluster layout (engine/src/graph.ts); this file only draws it. Clicking a node selects it; hovering
// shows its full label and lights its links; `hidden` hides node types (the left rail's filters).
//
// Team review, round 3: a Fit control and a visible pan affordance (drag the paper to pan, wheel to zoom),
// and a focus mode: `focus` (engine/src/graph.ts focusGraph) keeps only the chain behind one decision,
// laid out left to right (records → the lot and its result → the rule → its exact quote → who reviewed it).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { dayOf } from '@engine/format';
import { focusFrame, GRAPH_FRAME, layoutFocus, layoutGraph, type Cluster, type EdgeKind, type GraphEdge, type GraphFocus, type GraphNode, type LotGraph, type NodeType } from '@engine/graph';
import '../../styles/graph.css';

type Pt = { x: number; y: number };

/** Words for each node type: aria labels and the inspector's kicker. */
export const NODE_TYPE_WORDS: Record<NodeType, string> = {
  lot: 'Lot',
  neighbor: 'Neighbor lot',
  rule: 'Rule',
  quote: 'Verbatim quote',
  person: 'Signer',
  source: 'Dataset',
  estimate: 'Practitioner estimate',
  sale: 'Comparable sale',
  site: 'Site condition',
  office: 'Office',
};
/** Shorter words for the legend, where the trust line says the rest. */
const LEGEND_WORDS: Record<NodeType, string> = {
  lot: 'Lot',
  neighbor: 'Neighbor',
  rule: 'Rule',
  quote: 'Quote',
  person: 'Signer',
  source: 'Dataset',
  estimate: 'Estimate',
  sale: 'Sale',
  site: 'Site',
  office: 'Office',
};

// Average advance per character, in px, for the faces and sizes used here. Labels are cut to fit their
// column; the full text is in the hover label and the inspector.
const ADV = { label: 6.4, source: 6.1, sub: 4.75, center: 7.7, centerSub: 5.3, status: 5.9, pill: 4.9, quote: 5.9 };
function fit(s: string | undefined, px: number, adv: number): string {
  if (!s) return '';
  const max = Math.max(3, Math.floor(px / adv));
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}
const est = (s: string, adv: number) => s.length * adv;
/** Word-wrap into at most `n` lines of `px`; the last line is cut with an ellipsis if needed. Breaks
 *  at " · " first, so "Lot 25 · 2241 Mahon St" becomes "Lot 25" over "2241 Mahon St". */
function wrap(s: string | undefined, px: number, adv: number, n: number): string[] {
  if (!s) return [];
  const max = Math.max(4, Math.floor(px / adv));
  if (s.length <= max) return [s];
  const parts = s.split(' · ');
  if (parts.length > 1 && parts.every((x) => x.length <= max)) {
    // Greedy over the parts, joined back with the separator where they fit.
    const out: string[] = [];
    for (const x of parts) {
      const last = out[out.length - 1];
      if (last && `${last} · ${x}`.length <= max) out[out.length - 1] = `${last} · ${x}`;
      else out.push(x);
    }
    if (out.length <= n) return out;
  }
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= max || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= n) return lines;
  return [...lines.slice(0, n - 1), fit(lines.slice(n - 1).join(' '), px, adv)];
}

type Side = 'left' | 'right' | 'below' | 'none';
interface Face {
  side: Side;
  label: string;
  sub: string;
  lines: string[]; // 'below', and a focused quote's words ('right')
  names?: number; // 'below' only: how many of `lines` are the name (the rest are its sub)
  cx: number; // 'below' only: the text's centre, kept inside the canvas
  width: number; // px of the widest line
  small: boolean; // the dataset face (one line, slightly smaller)
  quote?: boolean; // a focused quote: its words, word for word, beside the mark
}

/** What a node shows on the canvas and where, from the fixed frame. In a compact drawing (a narrow pane)
 *  the least important words go first: a neighbour's owner line and a rule's citation (both stay in the
 *  hover label, the aria label and the inspector); every node and its name stay. In focus mode a rule shows
 *  its citation, a quote shows its words (up to four lines) and a signer shows the note they signed with. */
function faceOf(n: GraphNode, p: Pt, w: number, compact = false, focus: { extra?: string[] } | null = null): Face {
  const F = GRAPH_FRAME;
  const none: Face = { side: 'none', label: '', sub: '', lines: [], cx: 0, width: 0, small: false };
  const side = (s: Side, room: number, withSub: boolean, small = false): Face => {
    const label = fit(n.label, room, small ? ADV.source : ADV.label);
    const sub = withSub ? fit(n.sub, room, ADV.sub) : '';
    return { side: s, label, sub, lines: [], cx: 0, width: Math.max(est(label, small ? ADV.source : ADV.label), est(sub, ADV.sub)), small };
  };
  const focusRoom = focusFrame(w).textRoom;
  switch (n.type) {
    case 'neighbor':
      return side('left', p.x - 26, !compact || !!focus);
    case 'source':
      return side('left', p.x - 26, false, true);
    case 'rule':
      return focus ? side('right', focusRoom, true) : side('right', (F.quotes.x - F.rules.x) * w - 34, !compact);
    case 'quote': {
      if (!focus) return none; // the mark alone: the quote is long; hover and the inspector show it word for word
      const lines = wrap(`“${(n.quote ?? '').replace(/\s+/g, ' ').trim()}”`, focusRoom, ADV.quote, 4);
      return { side: 'right', label: '', sub: '', lines, cx: 0, width: Math.max(...lines.map((l) => est(l, ADV.quote))), small: false, quote: true };
    }
    case 'person': {
      // Compact: the name wraps (at most two lines of about 100 px) so the column clears the quote marks.
      const names = compact && !focus ? wrap(n.label, 100, ADV.label, 2) : [n.label];
      const extra = focus?.extra ?? [];
      const lines = [...names, ...(n.sub ?? '').split(' · ').filter(Boolean), ...extra];
      const width = Math.max(...lines.map((l, i) => est(l, i < names.length ? ADV.label : ADV.sub)));
      return { side: 'below', label: n.label, sub: '', lines, names: names.length, cx: Math.min(p.x, w - 14 - width / 2), width, small: false };
    }
    case 'estimate':
    case 'sale':
      return focus ? side('right', 200, true) : side('left', p.x - 13 - (F.sources.x * w + 24), true);
    case 'site':
      return side('right', focus ? 200 : w - p.x - 26, true);
    case 'office':
      return side('right', focus ? 200 : w - p.x - 26, false);
    default:
      return side('right', 160, true);
  }
}

function slug(k: string): string {
  return k.replace(/\s+/g, '-');
}

// ─── Glyphs: one shape per node type (DESIGN_GUIDE §5: every meaning also has a shape) ───────────

function Glyph({ n }: { n: Pick<GraphNode, 'type' | 'ai' | 'city'> }) {
  switch (n.type) {
    case 'lot':
      return (
        <g className="gr-glyph">
          <rect x={-8} y={-6} width={16} height={12} />
          <rect x={-5.5} y={-3.5} width={11} height={7} className="gr-fine" />
        </g>
      );
    case 'neighbor':
      return (
        <g className="gr-glyph">
          <rect x={-6.5} y={-8} width={13} height={16} />
          <path d="M-6.5 3.5h13" className="gr-fine" />
          {n.city && <circle cx={0} cy={-2} r={2.6} className={n.city === 'for_sale' ? 'gr-coin' : 'gr-coin is-ring'} />}
        </g>
      );
    case 'rule':
      return (
        <g className="gr-glyph">
          <rect x={-8} y={-8} width={16} height={16} />
          <text className="gr-glyph-text" y={4.5}>
            §
          </text>
        </g>
      );
    case 'quote':
      return (
        <g className="gr-glyph">
          <path d="M-6 -7.5h8.5l3.5 3.5v11.5h-12z" />
          <text className="gr-glyph-text is-quote" y={7}>
            “
          </text>
        </g>
      );
    case 'person':
      return n.ai ? (
        <g className="gr-glyph is-ai">
          <circle r={9} />
          <text className="gr-glyph-ai" y={3}>
            AI
          </text>
        </g>
      ) : (
        <g className="gr-glyph">
          <circle r={9} />
          <circle cy={-2.5} r={3} className="gr-fill" />
          <path d="M-5.5 6.5a5.5 4.5 0 0 1 11 0" className="gr-fill" />
        </g>
      );
    case 'source':
      return (
        <g className="gr-glyph">
          <path d="M-6 -8h8l4 4v12h-12z" />
          <path d="M2 -8v4h4M-3.5 -1h7M-3.5 2h7M-3.5 5h5" className="gr-fine" />
        </g>
      );
    case 'estimate':
      return (
        <g className="gr-glyph">
          <rect x={-5.5} y={-5.5} width={11} height={11} transform="rotate(45)" />
        </g>
      );
    case 'sale':
      return (
        <g className="gr-glyph">
          <rect x={-5.5} y={-5.5} width={11} height={11} transform="rotate(45)" className="gr-solid" />
        </g>
      );
    case 'site':
      return (
        <g className="gr-glyph">
          <path d="M-8 0l4-7h8l4 7-4 7h-8z" />
        </g>
      );
    case 'office':
      return (
        <g className="gr-glyph">
          <path d="M0 -8l8.5 14.5h-17z" />
        </g>
      );
  }
}

// ─── Edges ─────────────────────────────────────────────────────────────────────────────────────

interface EdgeGeom {
  e: GraphEdge;
  d: string;
  at: (t: number) => Pt;
  trust: string;
  span: number; // horizontal room along the edge, for choosing where a label fits
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): { d: string; at: (t: number) => Pt } {
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    d: `M${r(p0.x)} ${r(p0.y)}C${r(p1.x)} ${r(p1.y)} ${r(p2.x)} ${r(p2.y)} ${r(p3.x)} ${r(p3.y)}`,
    at: (t) => {
      const u = 1 - t;
      return {
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      };
    },
  };
}

/** Where along an edge its label sits, by kind: near the far end for fans into the lot's left side. */
const LABEL_T: Partial<Record<EdgeKind, number>> = {
  'needed to fit': 0.45,
  'adjacent to': 0.45,
  assesses: 0.35,
  ownership: 0.35,
  geometry: 0.35,
  'constrained by': 0.55,
  cites: 0.5,
  'signed by': 0.45,
  'estimates cost': 0.5,
  'comparable sale': 0.5,
  'has condition': 0.55,
  inquire: 0.6,
};
/** The kinds labelled when nothing is in focus: one label on one edge of each bundle. */
const DEFAULT_LABELS: EdgeKind[] = ['needed to fit', 'adjacent to', 'constrained by', 'cites', 'signed by', 'estimates cost', 'comparable sale', 'has condition', 'inquire'];

// ─── The canvas ────────────────────────────────────────────────────────────────────────────────

/** The drawing is laid out at the pane's size, or at FIT_MIN when the pane is smaller and then scaled down
 *  to the pane (never below FIT_FLOOR, so 11 px labels stay near 9 px). */
const FIT_MIN = { w: 700, h: 460 };
const FIT_FLOOR = 0.8;
/** The narrowest layout the cluster frame holds without collisions; a pane that would need less (a phone)
 *  keeps this layout at PHONE_SCALE and scrolls inside itself. */
const LAYOUT_MIN_W = 600;
const PHONE_SCALE = 0.85;
/** Layouts narrower than the frame's design width drop the least important words (faceOf). */
const COMPACT_BELOW = GRAPH_FRAME.min.w;
/** The reader's zoom: a little out, and in to four times. */
const VP_MIN = 0.6;
const VP_MAX = 4;

const RESULT_GLYPH: Record<string, string> = { fail: '✕', pass: '✓', open: '?', needs_survey: '?', not_assessed: '—', info: '·' };
const num = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');

export function GraphCanvas(p: {
  graph: LotGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  hidden?: Set<NodeType>;
  focus?: GraphFocus | null; // the chain behind one decision (focus mode)
  onFocus?: (id: string | null) => void; // focus the chain behind a node, or show the whole graph again
  controls?: ReactNode; // more buttons for the toolbar (the workspace's "Lot details" fold)
}): JSX.Element {
  const { selected, onSelect, hidden, focus } = p;
  const graph = focus ? focus.graph : p.graph;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 516 });
  const [hover, setHover] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      // Layout px (clientWidth), not getBoundingClientRect: under record mode's CSS zoom the latter is already
      // zoomed, and the SVG would be zoomed twice (it ran off the right edge of the 1920 px film frame).
      const r = { width: el.clientWidth, height: el.clientHeight };
      if (r.width > 0 && r.height > 0) setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The drawing fits its pane (judge round 2: at 1440 it was 860 px wide in a 664 px pane and the Offices
  // column hid behind the inspector). It is laid out at the pane's size, or at FIT_MIN when the pane is
  // smaller, and scaled down to the pane by the viewBox, never below FIT_FLOOR; a compact drawing drops
  // the least important words (faceOf). A phone's pane keeps a legible scale and scrolls inside itself.
  const fitK = Math.max(FIT_FLOOR, Math.min(1, size.w / FIT_MIN.w, size.h / FIT_MIN.h));
  const phone = size.w / fitK < LAYOUT_MIN_W;
  const scale = phone ? PHONE_SCALE : fitK;
  const W = Math.floor(phone ? LAYOUT_MIN_W : size.w / scale);
  const H = Math.floor(phone ? Math.max(FIT_MIN.h, size.h / scale) : size.h / scale);
  const compact = W < COMPACT_BELOW && !focus;
  const pos = useMemo(() => (focus ? layoutFocus(graph, W, H) : layoutGraph(graph, W, H)), [graph, W, H, !!focus]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // ── The reader's view: drag the paper to pan, wheel to zoom about the pointer, Fit to start again ──
  const [vp, setVp] = useState({ k: 1, x: 0, y: 0 });
  const vpKey = focus?.id ?? 'all'; // a new chain starts fitted; a resize keeps the reader's view
  useEffect(() => setVp({ k: 1, x: 0, y: 0 }), [vpKey]);
  const toUser = (cx: number, cy: number): Pt => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  };
  const zoomAbout = (f: number, at: Pt) =>
    setVp((v) => {
      const k = Math.min(VP_MAX, Math.max(VP_MIN, v.k * f));
      const g = k / v.k;
      return { k, x: at.x - (at.x - v.x) * g, y: at.y - (at.y - v.y) * g };
    });
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
      zoomAbout(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), toUser(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const onBgDown = (e: RPointerEvent<SVGRectElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const u = toUser(e.clientX, e.clientY);
    drag.current = { id: e.pointerId, x: u.x, y: u.y, vx: vp.x, vy: vp.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onBgMove = (e: RPointerEvent<SVGRectElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const u = toUser(e.clientX, e.clientY);
    const dx = u.x - d.x;
    const dy = u.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) setPanning(true);
    d.moved = true;
    setVp((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onBgUp = (e: RPointerEvent<SVGRectElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (!d.moved) onSelect(null); // a click on the paper clears the selection; a drag never does
  };
  const fitted = vp.k === 1 && vp.x === 0 && vp.y === 0;

  const isHidden = (n: GraphNode | undefined) => !n || (n.cluster !== 'center' && !focus && !!hidden?.has(n.type));
  const nodes = graph.nodes.filter((n) => !isHidden(n));
  const center = graph.nodes.find((n) => n.cluster === 'center');
  const edges = graph.edges.filter((e) => !isHidden(byId.get(e.from)) && !isHidden(byId.get(e.to)));
  // A focused signer shows the date and the note they signed with (from the rule's recorded signature).
  const signedExtra = (n: GraphNode): string[] => {
    const rule = graph.edges.filter((e) => e.kind === 'signed by' && e.to === n.id).map((e) => byId.get(e.from)).find((r) => r?.signed);
    const sg = rule?.signed;
    if (!sg) return [];
    return [...(sg.at ? [`signed ${dayOf(sg.at)}`] : []), ...(sg.note ? wrap(`“${sg.note.replace(/\s*\(docs\/[^)]*\)\s*$/, '')}”`, 150, ADV.sub, 3) : [])];
  };
  const faces = new Map(nodes.map((n) => [n.id, faceOf(n, pos.get(n.id)!, W, compact, focus ? { extra: n.type === 'person' ? signedExtra(n) : [] } : null)]));

  // The centre box: a fixed width; its name, line and status wrap rather than widen it. In focus mode it is
  // wider and carries the decision's result, as the engine wrote its checks.
  const cp = center ? pos.get(center.id)! : { x: W / 2, y: H / 2 };
  const bw = focus ? focusFrame(W).box : GRAPH_FRAME.center.w + 16;
  const cLabel = wrap(center?.label, bw - 18, ADV.center, 2);
  const cSub = wrap(center?.sub, bw - 18, ADV.centerSub, 2);
  const status = focus ? [] : wrap(center?.status, bw - 18, ADV.status, 3);
  const results = (focus?.result ?? []).map((r) => {
    const head = `${RESULT_GLYPH[r.status] ?? ''} ${r.label}`.trim();
    const line = r.available != null && r.required != null ? `${head}: ${num(r.available)} ${r.unit} for your ${num(r.required)} ${r.unit} plan` : `${head}: ${r.text}`;
    return { r, lines: wrap(line, bw - 18, ADV.status, r.available != null ? 2 : 5) };
  });
  const resH = results.length ? 26 + results.reduce((a, x) => a + x.lines.length * 13 + 3, 0) : 0;
  const bh = 16 + cLabel.length * 18 + cSub.length * 14 + status.length * 13 + resH + 4;
  const bx = { l: cp.x - bw / 2, r: cp.x + bw / 2, t: cp.y - bh / 2, b: cp.y + bh / 2 };

  // Edges that meet the centre box fan out along the side they arrive on, in the order of their far ends:
  // neighbors come in over the top, datasets on the left, money from below, everything else on the right.
  // In focus mode every record (dataset or neighbour) comes in on the left.
  type BoxSide = 'l' | 'r' | 'b' | 't';
  const boxSide = (c: Cluster): BoxSide => (focus ? (c === 'neighbors' || c === 'sources' ? 'l' : c === 'rules' ? 'r' : 'b') : c === 'neighbors' ? 't' : c === 'sources' ? 'l' : c === 'money' ? 'b' : 'r');
  const onSide = new Map<string, { i: number; n: number }>();
  for (const side of ['l', 'r', 'b', 't'] as const) {
    const list = edges
      .filter((e) => (e.from === center?.id || e.to === center?.id) && boxSide(byId.get(e.from === center?.id ? e.to : e.from)!.cluster) === side)
      .map((e) => ({ e, q: pos.get(e.from === center?.id ? e.to : e.from)! }))
      .sort((a, b) => (side === 'b' ? a.q.x - b.q.x : side === 't' ? b.q.y - a.q.y : a.q.y - b.q.y) || a.e.to.localeCompare(b.e.to));
    list.forEach(({ e }, i) => onSide.set(`${e.from}→${e.to}`, { i, n: list.length }));
  }
  const boxAnchor = (e: GraphEdge, other: GraphNode): Pt => {
    const s = boxSide(other.cluster);
    const k = onSide.get(`${e.from}→${e.to}`) ?? { i: 0, n: 1 };
    const f = k.n <= 1 ? 0.5 : k.i / (k.n - 1);
    if (s === 'b') return { x: bx.l + 16 + (bw - 32) * f, y: bx.b };
    if (s === 't') return { x: bx.l + 14 + (bw * 0.62 - 14) * f, y: bx.t };
    return { x: s === 'l' ? bx.l : bx.r, y: bx.t + 8 + (bh - 16) * f };
  };
  /** Right end of a node's words (or its mark, when it shows none). */
  const rightOf = (n: GraphNode): number => {
    const q = pos.get(n.id)!;
    const f = faces.get(n.id);
    return f && f.side === 'right' ? q.x + 13 + f.width + 5 : q.x + 10;
  };

  const geoms: EdgeGeom[] = [];
  for (const e of edges) {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    const pa = pos.get(a.id)!;
    const pb = pos.get(b.id)!;
    const ts = [a.trust, b.trust];
    const trust = ts.includes('pencil') ? 'pencil' : ts.includes('estimate') ? 'estimate' : ts.includes('unknown') ? 'unknown' : 'ink';
    let c: ReturnType<typeof cubic>;
    let span = 0;
    if (a.cluster === 'center' || b.cluster === 'center') {
      const other = a.cluster === 'center' ? b : a;
      const po = pos.get(other.id)!;
      const anchor = boxAnchor(e, other);
      const s = boxSide(other.cluster);
      if (s === 'b') {
        const g = { x: po.x, y: po.y - 10 };
        const dy = Math.max(18, (g.y - anchor.y) * 0.5);
        c = a.cluster === 'center' ? cubic(anchor, { x: anchor.x, y: anchor.y + dy }, { x: g.x, y: g.y - dy }, g) : cubic(g, { x: g.x, y: g.y - dy }, { x: anchor.x, y: anchor.y + dy }, anchor);
      } else if (s === 't') {
        // Out of the mark to the right, then down into the top of the box.
        const g = { x: po.x + 10, y: po.y };
        const dx = Math.max(20, (anchor.x - g.x) * 0.7);
        const dy = Math.max(16, (anchor.y - g.y) * 0.7);
        c = cubic(g, { x: g.x + dx, y: g.y }, { x: anchor.x, y: anchor.y - dy }, anchor);
        span = anchor.x - g.x;
      } else {
        const g = { x: po.x + (s === 'l' ? 10 : -10), y: po.y };
        const dx = Math.max(24, Math.abs(g.x - anchor.x) * 0.5);
        const [p0, p3] = a.cluster === 'center' ? [anchor, g] : [g, anchor];
        const dir = p3.x >= p0.x ? 1 : -1;
        c = cubic(p0, { x: p0.x + dx * dir, y: p0.y }, { x: p3.x - dx * dir, y: p3.y }, p3);
        span = Math.abs(g.x - anchor.x);
      }
    } else if (e.kind === 'cites') {
      if (focus) {
        // The quote sits under its rule: a short drop from the rule's mark to the quote's.
        const p0 = { x: pa.x, y: pa.y + 9 };
        const p3 = { x: pb.x, y: pb.y - 9 };
        c = cubic(p0, p0, p3, p3);
        span = 0;
      } else {
        const p0 = { x: rightOf(a), y: pa.y };
        const p3 = { x: pb.x - 9, y: pb.y };
        c = cubic(p0, { x: (p0.x + p3.x) / 2, y: p0.y }, { x: (p0.x + p3.x) / 2, y: p3.y }, p3);
        span = p3.x - p0.x;
      }
    } else if (e.kind === 'signed by') {
      // Drawn on from the rule's quote mark (focus: from the end of the rule's words), so the line runs
      // along the row and never under words.
      const qe = edges.find((x) => x.kind === 'cites' && x.from === a.id);
      const q = qe ? byId.get(qe.to) : undefined;
      if (focus && focusFrame(W).narrow) {
        // Narrow focus: the signer sits under the rules; the line leaves the rule's mark to the left and drops.
        const p0 = { x: pa.x - 9, y: pa.y };
        const p3 = { x: pb.x - 10, y: pb.y };
        c = cubic(p0, { x: p0.x - 26, y: p0.y }, { x: p3.x - 40, y: p3.y }, p3);
        span = 40;
      } else {
        const p0 = { x: focus ? rightOf(a) : q ? pos.get(q.id)!.x + 8 : rightOf(a), y: pa.y };
        const p3 = { x: pb.x - 10, y: pb.y };
        const dx = Math.max(14, (p3.x - p0.x) * 0.55);
        c = cubic(p0, { x: p0.x + dx, y: p0.y }, { x: p3.x - dx, y: p3.y }, p3);
        span = p3.x - p0.x;
      }
    } else if (a.cluster === 'sources' && b.cluster === 'neighbors') {
      // A dataset read for a neighbor: out to the right of the left-hand column and back.
      const p0 = { x: pa.x + 10, y: pa.y };
      const p3 = { x: pb.x + 10, y: pb.y };
      const dx = 26 + Math.abs(p3.y - p0.y) * 0.1;
      c = cubic(p0, { x: p0.x + dx, y: p0.y }, { x: p3.x + dx, y: p3.y }, p3);
    } else {
      c = cubic(pa, pa, pb, pb);
    }
    geoms.push({ e, d: c.d, at: c.at, trust, span });
  }

  // Headings above each cluster (focus mode: one per step of the chain).
  const heads: { key: string; x: number; y: number; anchor: 'start' | 'end' | 'middle'; text: string; cls: string }[] = [];
  const firstOf = (c: Cluster, t?: NodeType) => nodes.find((n) => n.cluster === c && (!t || n.type === t));
  const count = (c: Cluster, t?: NodeType) => nodes.filter((n) => n.cluster === c && (!t || n.type === t)).length;
  const head = (key: string, x: number, y: number, anchor: 'start' | 'end' | 'middle', text: string, cls = 'gr-head') => heads.push({ key, x: Math.round(x), y: Math.round(y), anchor, text, cls });
  if (focus) {
    const recs = nodes.filter((n) => n.type === 'source' || n.type === 'neighbor');
    const top = Math.min(...nodes.filter((n) => n.cluster !== 'center').map((n) => pos.get(n.id)!.y), bx.t) - 30;
    const hy = Math.max(26, top);
    const FF = focusFrame(W);
    if (recs.length) head('f-records', FF.records + 9, hy, 'end', `Records · ${recs.length}`);
    head('f-lot', cp.x, Math.min(hy, bx.t - 12), 'middle', 'The lot and its result');
    if (nodes.some((n) => n.type === 'rule')) head('f-rules', FF.rules - 9, hy, 'start', FF.narrow ? 'The rule, its exact quote, its reviewer' : 'The rule and its exact quote');
    if (FF.persons != null) {
      if (nodes.some((n) => n.type === 'person') || nodes.some((n) => n.type === 'rule')) head('f-signed', FF.persons, hy, 'middle', 'Reviewed by');
      // A rule nobody signed says so in the reviewer's column (an absence, not a node).
      for (const r of nodes.filter((n) => n.type === 'rule' && !edges.some((e) => e.kind === 'signed by' && e.from === n.id)))
        head(`f-unsigned-${r.id}`, FF.persons, pos.get(r.id)!.y + 4, 'middle', 'not reviewed yet: pencil', 'gr-head-sub is-pencil');
    }
  } else {
    const nb = firstOf('neighbors');
    if (nb) head('neighbors', pos.get(nb.id)!.x + 9, pos.get(nb.id)!.y - 22, 'end', `Neighbors · ${count('neighbors')}`);
    const src = firstOf('sources');
    if (src) {
      const q = pos.get(src.id)!;
      const days = new Set(nodes.filter((n) => n.type === 'source').map((n) => (n.source.pulled ?? '').slice(0, 10)));
      head('sources', q.x + 9, q.y - 30, 'end', `Sources · ${count('sources')}`);
      if (days.size === 1 && [...days][0]) head('sources-day', q.x + 9, q.y - 17, 'end', `pulled ${[...days][0]}`, 'gr-head-sub');
    }
    const r0 = firstOf('rules', 'rule');
    const q0 = firstOf('rules', 'quote');
    const p0 = firstOf('rules', 'person');
    const ry = r0 ? pos.get(r0.id)!.y - 22 : q0 ? pos.get(q0.id)!.y - 22 : 20;
    if (r0) head('rules', pos.get(r0.id)!.x - 9, ry, 'start', `Rules · ${count('rules', 'rule')}`);
    if (q0) head('quotes', pos.get(q0.id)!.x, ry, 'middle', 'Quote');
    if (p0) head('signers', faces.get(p0.id)!.cx, ry, 'middle', 'Signed by');
    const m0 = firstOf('money');
    if (m0) head('money', pos.get(m0.id)!.x + 9, pos.get(m0.id)!.y - 21, 'end', 'Money');
    const s0 = firstOf('site');
    if (s0) head('site', pos.get(s0.id)!.x - 9, pos.get(s0.id)!.y - 21, 'start', 'Site · not assessed');
    const n0 = firstOf('next');
    if (n0) head('next', pos.get(n0.id)!.x - 9, pos.get(n0.id)!.y - 18, 'start', 'Next · draft letters');
  }

  // What an edge label must not cover: the centre box, every mark and its words, and the headings.
  type Box = { l: number; t: number; r: number; b: number };
  const avoid: Box[] = [{ l: bx.l - 2, t: bx.t - 2, r: bx.r + 2, b: bx.b + 2 }];
  for (const n of nodes) {
    if (n.cluster === 'center') continue;
    const q = pos.get(n.id)!;
    const f = faces.get(n.id)!;
    avoid.push({ l: q.x - 11, t: q.y - 11, r: q.x + 11, b: q.y + 11 });
    const bottom = q.y + (f.quote ? f.lines.length * 12 : f.sub ? 13 : 7);
    if (f.side === 'left') avoid.push({ l: q.x - 13 - f.width, t: q.y - 11, r: q.x - 10, b: bottom });
    else if (f.side === 'right') avoid.push({ l: q.x + 10, t: q.y - 11, r: q.x + 13 + f.width, b: bottom });
    else if (f.side === 'below') avoid.push({ l: f.cx - f.width / 2, t: q.y + 12, r: f.cx + f.width / 2, b: q.y + 16 + f.lines.length * 12 });
  }
  for (const hd of heads) {
    const wd = hd.text.length * (hd.cls === 'gr-head' ? 7.3 : 4.9);
    const l = hd.anchor === 'start' ? hd.x : hd.anchor === 'end' ? hd.x - wd : hd.x - wd / 2;
    avoid.push({ l, t: hd.y - 10, r: l + wd, b: hd.y + 3 });
  }
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const placed: Box[] = [];
  const labelAt = new Map<GraphEdge, Pt>();
  /** The spot along one of `cands` where the label covers the least; fixed order, so always the same answer. */
  const place = (cands: EdgeGeom[]) => {
    const kind = cands[0].e.kind;
    const wd = est(kind, ADV.pill) + 10;
    const pref = LABEL_T[kind] ?? 0.5;
    const mid = (cands.length - 1) / 2;
    let best: { g: EdgeGeom; p: Pt; box: Box } | null = null;
    let bestCost = Infinity;
    cands.forEach((g, gi) => {
      for (let k = 3; k <= 17; k++) {
        const t = k / 20;
        const m = g.at(t);
        const bb = { l: m.x - wd / 2, t: m.y - 8, r: m.x + wd / 2, b: m.y + 8 };
        let cost = Math.abs(t - pref) * 30 + Math.abs(gi - mid) * 4;
        for (const o of avoid) cost += overlap(bb, o);
        for (const o of placed) cost += overlap(bb, o) * 3;
        if (bb.l < 12 || bb.r > W - 12 || bb.t < 12 || bb.b > H - 12) cost += 5000;
        if (cost < bestCost) {
          bestCost = cost;
          best = { g, p: m, box: bb };
        }
      }
    });
    if (best) {
      const b = best as { g: EdgeGeom; p: Pt; box: Box };
      placed.push(b.box);
      labelAt.set(b.g.e, b.p);
    }
  };

  // Edge labels: one per kind among the links of the node in focus; then, unless the pointer is on a
  // node, one per bundle of the same kind across the graph. (A focused chain labels every edge but the
  // short drop from a rule to its quote.)
  const lit = hover ?? selected;
  // The lot touches nearly every edge: in focus it lights them all, but its labels stay one per bundle.
  const litEdges = lit && byId.get(lit)?.cluster !== 'center' ? geoms.filter((g) => g.e.from === lit || g.e.to === lit) : [];
  const litKinds = [...new Set(litEdges.map((g) => g.e.kind))];
  for (const k of litKinds) place(litEdges.filter((g) => g.e.kind === k));
  if (!hover || byId.get(hover)?.cluster === 'center')
    for (const k of DEFAULT_LABELS)
      if (!litKinds.includes(k)) {
        const list = geoms.filter((g) => g.e.kind === k && !(focus && k === 'cites'));
        if (list.length) place(list);
      }
  const near = new Set<string>();
  if (hover) {
    near.add(hover);
    for (const e of edges) if (e.from === hover || e.to === hover) near.add(e.from === hover ? e.to : e.from);
  }

  const onKey = (ev: KeyboardEvent, id: string) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onSelect(id);
    } else if (ev.key === 'Escape') onSelect(null);
  };

  const hovered = hover ? byId.get(hover) : undefined;
  const selNode = selected ? byId.get(selected) : undefined;

  return (
    <div className={`gr${focus ? ' is-focus' : ''}`} data-graph-mode={focus ? 'focus' : 'all'}>
      <div className="gr-scroll" ref={box}>
        <svg
          ref={svg}
          className={`gr-svg${panning ? ' is-panning' : ''}`}
          width={Math.floor(W * scale)}
          height={Math.floor(H * scale)}
          viewBox={`0 0 ${W} ${H}`}
          data-scale={Math.round(scale * 100) / 100}
          data-compact={compact ? '1' : undefined}
          role="group"
          aria-label={`${focus ? 'The chain behind one decision' : 'Graph'} of ${center?.label ?? 'the lot'}: ${nodes.length} nodes, ${edges.length} links. Drag the paper to pan; scroll to zoom.`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onSelect(null);
          }}
        >
          <defs>
            <pattern id="gr-grid" width={24} height={24} patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" className="gr-grid-line" />
            </pattern>
            {(['ink', 'pencil', 'estimate', 'unknown'] as const).map((t) => (
              <marker key={t} id={`gr-arrow-${t}`} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6.5} markerHeight={6.5} orient="auto-start-reverse">
                <path d="M0.5 1L7 4L0.5 7" className={`gr-arrow t-${t}`} />
              </marker>
            ))}
          </defs>
          <rect className="gr-bg" width={W} height={H} onPointerDown={onBgDown} onPointerMove={onBgMove} onPointerUp={onBgUp} onPointerCancel={onBgUp} data-graph="paper" />
          <g className="gr-view" transform={fitted ? undefined : `translate(${vp.x.toFixed(1)} ${vp.y.toFixed(1)}) scale(${vp.k.toFixed(4)})`} pointerEvents="none">
            <rect className="gr-grid" x={-W} y={-H} width={W * 3} height={H * 3} />
          </g>
          <rect className="gr-frame" x={4.5} y={4.5} width={W - 9} height={H - 9} pointerEvents="none" />
          <rect className="gr-frame is-inner" x={8.5} y={8.5} width={W - 17} height={H - 17} pointerEvents="none" />
          <g className="gr-view" transform={fitted ? undefined : `translate(${vp.x.toFixed(1)} ${vp.y.toFixed(1)}) scale(${vp.k.toFixed(4)})`}>
            <g className="gr-heads" aria-hidden="true">
              {heads.map((hd) => (
                <text key={hd.key} className={hd.cls} x={hd.x} y={hd.y} textAnchor={hd.anchor}>
                  {hd.text}
                </text>
              ))}
            </g>

            <g className="gr-edges" aria-hidden="true">
              {geoms.map((g) => {
                const on = lit ? g.e.from === lit || g.e.to === lit : false;
                const faint = byId.get(g.e.from)!.cluster === 'sources' && byId.get(g.e.to)!.cluster === 'neighbors';
                return (
                  <path
                    key={`${g.e.from}→${g.e.to}`}
                    d={g.d}
                    className={`gr-edge k-${slug(g.e.kind)} t-${g.trust}${on ? ' is-on' : ''}${hover && !on ? ' is-dim' : ''}${faint && !on ? ' is-faint' : ''}`}
                    markerEnd={`url(#gr-arrow-${g.trust})`}
                    data-edge-kind={g.e.kind}
                    data-from={g.e.from}
                    data-to={g.e.to}
                  />
                );
              })}
            </g>
            <g className="gr-edge-labels" aria-hidden="true">
              {geoms
                .filter((g) => labelAt.has(g.e))
                .map((g) => {
                  const wd = est(g.e.kind, ADV.pill) + 10;
                  const m = labelAt.get(g.e)!;
                  const dim = hover && !(g.e.from === hover || g.e.to === hover);
                  return (
                    <g key={`l-${g.e.from}→${g.e.to}`} transform={`translate(${Math.round(m.x)} ${Math.round(m.y)})`} className={`gr-pill k-${slug(g.e.kind)}${dim ? ' is-dim' : ''}`} data-edge-label={g.e.kind} data-from={g.e.from} data-to={g.e.to}>
                      <rect x={-wd / 2} y={-7.5} width={wd} height={15} rx={2} />
                      <text y={3.6}>{g.e.kind}</text>
                    </g>
                  );
                })}
            </g>

            <g className="gr-nodes">
              {nodes.map((n) => {
                const q = pos.get(n.id)!;
                const isSel = n.id === selected;
                const dim = hover ? !near.has(n.id) : false;
                const cls = `gr-node ty-${n.type} t-${n.trust}${isSel ? ' is-selected' : ''}${n.id === hover ? ' is-hover' : ''}${dim ? ' is-dim' : ''}${n.flag ? ' is-flag' : ''}${n.ai ? ' is-ai' : ''}${focus?.id === n.id ? ' is-focused' : ''}`;
                const aria = `${NODE_TYPE_WORDS[n.type]}: ${n.type === 'quote' ? fit(n.quote ?? n.label, 160, 1) : n.label}${n.sub ? `. ${n.sub}` : ''}${n.status ? `. ${n.status}` : ''}`;
                const common = {
                  className: cls,
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': aria,
                  'aria-pressed': isSel,
                  'data-node': n.id,
                  'data-node-type': n.type,
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    onSelect(n.id);
                  },
                  onDoubleClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    if (p.onFocus && n.cluster !== 'center') p.onFocus(n.id);
                  },
                  onKeyDown: (e: KeyboardEvent) => onKey(e, n.id),
                  onMouseEnter: () => setHover(n.id),
                  onMouseLeave: () => setHover((h) => (h === n.id ? null : h)),
                  onFocus: () => setHover(n.id),
                  onBlur: () => setHover((h) => (h === n.id ? null : h)),
                };
                if (n.cluster === 'center') {
                  const y0 = -bh / 2 + 24;
                  const yRes = y0 + cLabel.length * 18 + cSub.length * 14 - 3;
                  return (
                    <g key={n.id} {...common} transform={`translate(${q.x} ${q.y})`}>
                      <rect className="gr-center" x={-bw / 2} y={-bh / 2} width={bw} height={bh} />
                      <rect className="gr-center is-inner" x={-bw / 2 + 3.5} y={-bh / 2 + 3.5} width={bw - 7} height={bh - 7} />
                      {cLabel.map((l, i) => (
                        <text key={`l${i}`} className="gr-center-label" y={y0 + i * 18} textAnchor="middle">
                          {l}
                        </text>
                      ))}
                      {cSub.map((l, i) => (
                        <text key={`s${i}`} className="gr-center-sub" y={y0 + cLabel.length * 18 + i * 14 - 3} textAnchor="middle">
                          {l}
                        </text>
                      ))}
                      {status.map((l, i) => (
                        <text key={`t${i}`} className="gr-center-status" y={y0 + cLabel.length * 18 + cSub.length * 14 + i * 13 + 1} textAnchor="middle">
                          {l}
                        </text>
                      ))}
                      {results.length > 0 && (
                        <g className="gr-result" data-focus-result>
                          <line x1={-bw / 2 + 12} x2={bw / 2 - 12} y1={yRes + 2} y2={yRes + 2} className="gr-result-rule" />
                          <text className="gr-result-head" y={yRes + 15} textAnchor="middle">
                            RESULT
                          </text>
                          {results.map(({ r, lines }, k) => {
                            const y = yRes + 29 + results.slice(0, k).reduce((a, x) => a + x.lines.length * 13 + 3, 0);
                            return (
                              <g key={r.id} className={`gr-result-row t-${r.trust} s-${r.status}`} data-result={r.id}>
                                {lines.map((l, i) => (
                                  <text key={i} className={`gr-result-line${r.available != null ? ' is-main' : ''}`} y={y + i * 13} textAnchor="middle">
                                    {l}
                                  </text>
                                ))}
                              </g>
                            );
                          })}
                        </g>
                      )}
                    </g>
                  );
                }
                const f = faces.get(n.id)!;
                const lx = f.side === 'left' ? -13 : 13;
                const anchor = f.side === 'left' ? 'end' : 'start';
                const hitW = f.quote ? f.width + 32 : f.width + 32;
                const hitH = f.quote ? 12 + f.lines.length * 12 : 24;
                return (
                  <g key={n.id} {...common} transform={`translate(${q.x} ${q.y})`}>
                    {f.side === 'below' ? (
                      <rect className="gr-hit" x={f.cx - q.x - f.width / 2 - 4} y={-12} width={f.width + 8} height={24 + f.lines.length * 12} />
                    ) : f.side === 'none' ? (
                      <rect className="gr-hit" x={-11} y={-11} width={22} height={22} />
                    ) : (
                      <rect className="gr-hit" x={f.side === 'left' ? -f.width - 20 : -12} y={-12} width={hitW} height={hitH} />
                    )}
                    {(isSel || n.id === hover) && <circle className="gr-halo" r={13} />}
                    <Glyph n={n} />
                    {f.side === 'below' &&
                      f.lines.map((l, i) => (
                        <text key={i} className={i < (f.names ?? 1) ? 'gr-label' : `gr-sub${focus && n.type === 'person' && l.startsWith('“') ? ' is-note' : ''}`} x={f.cx - q.x} y={24 + i * 12} textAnchor="middle">
                          {l}
                        </text>
                      ))}
                    {f.quote &&
                      f.lines.map((l, i) => (
                        <text key={i} className={`gr-quote-line t-${n.trust}`} x={13} y={4 + i * 12}>
                          {l}
                        </text>
                      ))}
                    {!f.quote && (f.side === 'left' || f.side === 'right') && (
                      <>
                        <text className={`gr-label${f.small ? ' is-small' : ''}`} x={lx} y={f.sub ? -1.5 : 4} textAnchor={anchor}>
                          {f.label}
                        </text>
                        {f.sub && (
                          <text className="gr-sub" x={lx} y={9.5} textAnchor={anchor}>
                            {f.sub}
                          </text>
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </g>

            {hovered && <HoverLabel n={hovered} q={pos.get(hovered.id)!} w={W} h={H} bh={bh} />}
          </g>
        </svg>
        <div className="gr-controls" role="toolbar" aria-label="Graph view">
          {p.controls}
          {focus ? (
            <button type="button" className="gr-ctl is-text" data-graph-control="show-all" onClick={() => p.onFocus?.(null)} title="Show the whole graph again">
              Show all
            </button>
          ) : selNode && selNode.cluster !== 'center' && p.onFocus ? (
            <button type="button" className="gr-ctl is-text" data-graph-control="focus" onClick={() => p.onFocus!(selNode.id)} title="Show only the chain behind this node's decision (or double-click a node)">
              Focus on this chain
            </button>
          ) : null}
          <button type="button" className="gr-ctl is-text" data-graph-control="fit" disabled={fitted} onClick={() => setVp({ k: 1, x: 0, y: 0 })} title="Fit the whole drawing to the pane">
            Fit
          </button>
          <button type="button" className="gr-ctl" data-graph-control="zoom-in" aria-label="Zoom in" onClick={() => zoomAbout(1.4, { x: W / 2, y: H / 2 })}>
            +
          </button>
          <button type="button" className="gr-ctl" data-graph-control="zoom-out" aria-label="Zoom out" onClick={() => zoomAbout(1 / 1.4, { x: W / 2, y: H / 2 })}>
            −
          </button>
        </div>
      </div>
      <Legend graph={graph} hidden={focus ? undefined : hidden} hint={`Drag the paper to pan · scroll to zoom${focus ? '' : ' · double-click a node to focus its chain'}`} />
    </div>
  );
}

/** The full words of the node under the pointer (labels on the canvas are cut to their column). */
function HoverLabel({ n, q, w, h, bh }: { n: GraphNode; q: Pt; w: number; h: number; bh: number }) {
  const first = n.type === 'quote' ? `“${(n.quote ?? '').replace(/\s+/g, ' ').trim()}”` : n.label;
  const lines = [...wrap(first, 440, ADV.label, n.type === 'quote' ? 4 : 2), ...[n.sub, n.status].filter((x): x is string => !!x).map((x) => fit(x, 440, ADV.sub))];
  const nFirst = lines.length - [n.sub, n.status].filter(Boolean).length;
  const wd = Math.min(470, Math.max(...lines.map((l, i) => est(l, i < nFirst ? ADV.label : ADV.sub))) + 20);
  const ht = 10 + lines.length * 14;
  let x = q.x + 16;
  let y = q.y - ht - 14;
  if (n.cluster === 'center') y = q.y - bh / 2 - ht - 8;
  if (x + wd > w - 10) x = Math.max(10, q.x - wd - 16);
  if (y < 10) y = q.y + 18;
  if (y + ht > h - 10) y = h - 10 - ht;
  return (
    <g className="gr-tip" transform={`translate(${Math.round(x)} ${Math.round(y)})`} pointerEvents="none" aria-hidden="true">
      <rect width={wd} height={ht} />
      {lines.map((l, i) => (
        <text key={i} x={10} y={18 + i * 14} className={i < nFirst ? 'gr-tip-label' : 'gr-tip-sub'}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Legend({ graph, hidden, hint }: { graph: LotGraph; hidden?: Set<NodeType>; hint?: string }) {
  const types = [...new Set(graph.nodes.map((n) => n.type))].filter((t) => t === 'lot' || !hidden?.has(t));
  const people = graph.nodes.filter((n) => n.type === 'person');
  const ai = people.some((n) => n.ai);
  const city = graph.nodes.some((n) => n.city) && !hidden?.has('neighbor');
  const trustOf = (t: NodeType) => (t === 'estimate' ? 'estimate' : t === 'site' ? 'unknown' : 'ink');
  return (
    <div className="gr-legend" aria-label="Legend">
      <ul>
        {types.map((t) => (
          <li key={t}>
            <svg className={`gr-legend-glyph t-${trustOf(t)}`} width={18} height={18} viewBox="-10 -10 20 20" aria-hidden="true">
              <Glyph n={{ type: t, ai: t === 'person' && people.length > 0 && people.every((x) => x.ai) }} />
            </svg>
            {LEGEND_WORDS[t]}
          </li>
        ))}
        {city && (
          <li>
            <svg className="gr-legend-glyph t-ink" width={18} height={18} viewBox="-10 -10 20 20" aria-hidden="true">
              <Glyph n={{ type: 'neighbor', city: 'for_sale' }} />
            </svg>
            City-owned, for sale
          </li>
        )}
      </ul>
      <ul>
        <li>
          <span className="gr-sw t-ink" /> Ink: sourced
        </li>
        <li>
          <span className="gr-sw t-pencil" /> Pencil: not reviewed yet
        </li>
        <li>
          <span className="gr-sw t-estimate" /> Practitioner estimate
        </li>
        <li>
          <span className="gr-sw t-unknown" /> Not assessed
        </li>
        {ai && (
          <li>
            <span className="gr-ai-chip">AI</span> An AI check, not a person
          </li>
        )}
        {hint && <li className="gr-hint">{hint}</li>}
      </ul>
    </div>
  );
}
