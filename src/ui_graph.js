// ui_graph.js — SVG · 포인터 제스처 · 단계적 노출 · 선 최근접 판정
//
// **포인터 이벤트만 쓴다**(계획서 §7). 마우스·손가락·펜이 한 코드로 처리된다.
//
// 관계는 단계적으로 드러난다:
//   0 쉼   — 노드만. 선도 라벨도 없다
//   1 훑기 — 노드에 마우스를 올리면 그 인물의 선만. **관계명은 안 나온다**
//   2 고정 — 노드를 클릭하면 선이 고정되고 관계 카드가 뜬다
//   3 확인 — 고정 상태에서 선을 클릭하면 그 관계의 라벨과 텍스트가 나온다
//
// 아이패드에는 1단계가 없다 — 터치에 호버가 없어서 탭하면 곧바로 2단계로 간다.
// **길게 누르기는 쓰지 않는다.** 브라우저 자체 메뉴와 충돌한다.

import { state, parsed, adjacency, vocabulary, touchUI, subscribe, byId } from './state.js?v=20260726j';
import { moveCharacter, groupColor } from './model.js?v=20260726j';
import { colorOf, styleOf } from './roles.js?v=20260726j';
import { matchesQuery } from './parse.js?v=20260726j';

const SVGNS = 'http://www.w3.org/2000/svg';

const NODE_R = 34;        // 노드 카드의 대략 반경
const NEAR_NODE = 30;     // 노드 반경 + 이만큼은 선 판정에서 뺀다(§7)
const HIT_PX = 30;        // 이보다 멀면 빈 곳 클릭
const TIE_PX = 8;         // 후보 둘의 차가 이 안이면 묻는다
const TAP_PX = 5;         // 이 안에서 뗐으면 끈 게 아니라 누른 것
const PARALLEL_GAP = 20;  // 평행선 벌림
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;

let graph, viewport, svg, labelLayer, nodeLayer;
let hooks = {};

const nodeEls = new Map();
let edges = [];            // 지금 그려진 선들 {rel, group, pts, color, style}
let hotKey = null;         // 카드에서 손을 올린 관계
let openEdgeKey = null;    // 3단계 — 눌러서 라벨이 나온 관계 쌍

// ── 관계 만들기(2단계)
let connectMode = false;   // 아이패드 경로: 버튼을 켜고 A 탭 → B 탭
let connectFrom = null;    // 연결 모드에서 먼저 고른 인물
let wire = null;           // 연결점을 끄는 중 { fromId, x, y }
let wireEl = null;         // 고무줄 선

// ── 4단계
let hiddenCats = new Set();  // 범례에서 끈 계열
let query = '';              // 검색어 — 걸리는 노드만 표시가 붙는다

// ─────────────────────────────────────────── 초기화

export function initGraph(opts = {}) {
  hooks = opts;
  graph = document.getElementById('graph');
  viewport = document.getElementById('viewport');
  svg = document.getElementById('edges');
  labelLayer = document.getElementById('labels');
  nodeLayer = document.getElementById('nodes');

  graph.addEventListener('pointerdown', onPointerDown);
  graph.addEventListener('pointermove', onPointerMove);
  graph.addEventListener('pointerup', onPointerUp);
  graph.addEventListener('pointercancel', onPointerCancel);
  graph.addEventListener('lostpointercapture', onPointerCancel);
  graph.addEventListener('wheel', onWheel, { passive: false });
  graph.addEventListener('contextmenu', (e) => e.preventDefault());

  subscribe(render);
  render();
}

// ─────────────────────────────────────────── 좌표

function toGraph(clientX, clientY) {
  const r = graph.getBoundingClientRect();
  const { tx, ty, scale } = state.ui;
  return [(clientX - r.left - tx) / scale, (clientY - r.top - ty) / scale];
}

function insideGraph(clientX, clientY) {
  const r = graph.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

function applyTransform() {
  const { tx, ty, scale } = state.ui;
  viewport.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function setScale(next, cx, cy) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  const { tx, ty, scale } = state.ui;
  const r = graph.getBoundingClientRect();
  const px = cx - r.left, py = cy - r.top;
  // 포인터 아래 지점이 그대로 있게 이동값을 보정한다
  state.ui.tx = px - ((px - tx) / scale) * s;
  state.ui.ty = py - ((py - ty) / scale) * s;
  state.ui.scale = s;
  applyTransform();
}

/** 전부 보이게 맞춘다. */
export function fitToView(pad = 70) {
  const chars = state.characters.filter((c) => Array.isArray(c.pos));
  if (!chars.length) {
    Object.assign(state.ui, { tx: 0, ty: 0, scale: 1 });
    applyTransform();
    return;
  }
  const r = graph.getBoundingClientRect();
  // 관계도가 접혀 있거나 아직 배치 전이면 크기가 0 이다. 그대로 계산하면 배율이
  // 최소값으로 튀고 화면이 엉킨 채 남는다 — 그냥 아무것도 안 하는 게 맞다.
  if (r.width < 40 || r.height < 40) return;

  const xs = chars.map((c) => c.pos[0]);
  const ys = chars.map((c) => c.pos[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0))),
  );
  state.ui.scale = s;
  state.ui.tx = r.width / 2 - ((x0 + x1) / 2) * s;
  state.ui.ty = r.height / 2 - ((y0 + y1) / 2) * s;
  applyTransform();
}

// ─────────────────────────────────────────── 제스처

const pointers = new Map();
let drag = null;          // { id, el, dx, dy, moved }
let pan = null;           // { x, y, tx, ty, moved }
let pinch = null;         // { dist, scale, cx, cy }

function nodeFromEvent(e) {
  const el = e.target.closest?.('.node');
  return el ? el.dataset.id : null;
}

/**
 * 관계 카드 · 도구 단추 · 선 후보 목록은 **관계도 위에 떠 있는 별개의 UI** 다.
 * 다만 DOM 상으로는 `.graph` 안에 있어서 포인터 이벤트가 여기까지 올라온다.
 *
 * 걸러내지 않으면 이렇게 된다 — 카드의 단추를 누르면 관계도가 「빈 곳 누름」으로
 * 받아 pointerup 에서 선택을 풀고, 그 바람에 카드가 다시 그려지면서 **눌린 단추가
 * DOM 에서 사라진다. 그러면 click 이 아예 안 와서 아무 일도 일어나지 않는다.**
 */
function onOverlay(e) {
  return !!e.target.closest?.('#card, #graph-tools, #edge-pick');
}

function onPointerDown(e) {
  if (onOverlay(e)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    // 두 손가락 — 끌던 걸 멈추고 확대로 넘어간다
    drag = null; pan = null;
    const [a, b] = [...pointers.values()];
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      scale: state.ui.scale,
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    };
    return;
  }
  if (pointers.size > 2) return;

  const id = nodeFromEvent(e);
  // 캡처를 못 잡아도 끌기는 돼야 한다 — 여기서 던지면 노드가 아예 안 움직인다
  try { graph.setPointerCapture(e.pointerId); } catch { /* noop */ }

  // **몸통은 이동, 연결점은 연결.** 위치로 구분하니 헷갈릴 일이 없다(§7)
  if (e.target.closest?.('.port') && id) {
    const c = byId(id);
    wire = { fromId: id, x: c.pos[0], y: c.pos[1] };
    drawEdges();
    return;
  }

  if (id) {
    const c = byId(id);
    const [gx, gy] = toGraph(e.clientX, e.clientY);
    drag = { id, el: nodeEls.get(id), dx: c.pos[0] - gx, dy: c.pos[1] - gy, moved: false, x: c.pos[0], y: c.pos[1] };
    drag.el?.classList.add('dragging');
  } else {
    pan = { x: e.clientX, y: e.clientY, tx: state.ui.tx, ty: state.ui.ty, moved: false };
  }
}

function onPointerMove(e) {
  if (onOverlay(e) && !drag && !pan && !wire && !pinch) return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.dist > 0) setScale(pinch.scale * (d / pinch.dist), pinch.cx, pinch.cy);
    return;
  }

  if (wire) {
    const [gx, gy] = toGraph(e.clientX, e.clientY);
    wire.x = gx; wire.y = gy;
    drawWire();
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.node');
    for (const [id, el] of nodeEls) el.classList.toggle('drop-target', el === over && id !== wire.fromId);
    return;
  }

  if (drag) {
    const [gx, gy] = toGraph(e.clientX, e.clientY);
    drag.x = gx + drag.dx;
    drag.y = gy + drag.dy;
    if (Math.abs(gx + drag.dx - byId(drag.id).pos[0]) > TAP_PX / state.ui.scale
      || Math.abs(gy + drag.dy - byId(drag.id).pos[1]) > TAP_PX / state.ui.scale) drag.moved = true;
    // 끄는 동안에는 **transform 하나만** 고친다. 상태는 놓을 때 한 번 바꾼다
    if (drag.el) drag.el.style.transform = `translate(${drag.x}px, ${drag.y}px) translate(-50%, -50%)`;
    drawEdges();
    return;
  }

  if (pan) {
    const ddx = e.clientX - pan.x, ddy = e.clientY - pan.y;
    if (Math.abs(ddx) > TAP_PX || Math.abs(ddy) > TAP_PX) pan.moved = true;
    state.ui.tx = pan.tx + ddx;
    state.ui.ty = pan.ty + ddy;
    applyTransform();
    return;
  }

  // 1단계 훑기 — **마우스일 때만.** 아이패드는 탭이 곧 2단계다
  if (e.pointerType === 'mouse' && !state.ui.focusId) {
    const id = nodeFromEvent(e);
    if (id !== state.ui.hoverId) {
      state.ui.hoverId = id;
      render();
    }
  }
}

function onPointerUp(e) {
  // 끌던 게 없는데 겹쳐 있는 UI 위에서 뗐으면 관계도가 상관할 일이 아니다
  if (onOverlay(e) && !drag && !pan && !wire) return;
  const wasDrag = drag, wasPan = pan, wasWire = wire;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;

  if (wasWire) {
    wire = null;
    for (const [, el] of nodeEls) el.classList.remove('drop-target');
    drawEdges();
    const overId = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.node')?.dataset.id;
    if (overId && overId !== wasWire.fromId) {
      hooks.onConnect?.(wasWire.fromId, overId);
    } else if (!overId && insideGraph(e.clientX, e.clientY)) {
      // **빈 곳에 놓으면 거기에 새 캐릭터를 만든다.** 인물 구상을 스케치하듯 뿌린다(§7)
      // 단 **관계도 밖(텍스트 칸·도구 막대)에 놓으면 조용히 무른다** — 거기 놓은 건
      // 「여기에 만들어달라」가 아니라 「그만두겠다」에 가깝다
      const [gx, gy] = toGraph(e.clientX, e.clientY);
      hooks.onConnectToEmpty?.(wasWire.fromId, gx, gy);
    }
    return;
  }

  if (wasDrag) {
    wasDrag.el?.classList.remove('dragging');
    drag = null;
    if (wasDrag.moved) {
      moveCharacter(wasDrag.id, wasDrag.x, wasDrag.y);   // ← 여기가 `1개` 다(§8)
    } else if (connectMode) {
      tapInConnectMode(wasDrag.id);                       // 아이패드 경로 — A 탭 → B 탭
    } else {
      select(wasDrag.id);                                 // 2단계 — 고정
    }
    return;
  }

  if (wasPan) {
    pan = null;
    if (wasPan.moved) return;
    if (connectMode) { cancelConnect(); return; }         // 빈 곳을 누르면 고르던 걸 무른다
    // 3단계 — 고정 상태에서 선 클릭. **전체 보기에서는 선 클릭을 안 받는다**(조망용)
    if (state.ui.focusId && !state.ui.showAll) {
      const hit = pickEdge(e.clientX, e.clientY);
      if (hit === 'ask') return;
      if (hit) { openEdge(hit); return; }
    }
    select(null);                                          // 빈 곳을 눌러 푼다
  }
}

function onPointerCancel(e) {
  // 이걸 빼면 손을 뗐는데도 노드가 따라다닌다(§7)
  pointers.delete(e.pointerId);
  if (drag) { drag.el?.classList.remove('dragging'); drag = null; render(); }
  if (wire) {
    wire = null;
    for (const [, el] of nodeEls) el.classList.remove('drop-target');
    drawEdges();
  }
  pan = null;
  if (pointers.size < 2) pinch = null;
}

// ─────────────────────────────────────────── 관계 만들기(2단계)

/**
 * 아이패드 경로. **길게 누르기는 쓰지 않는다** — 브라우저 자체 메뉴와 충돌해서
 * 「앱이 고장난 것 같다」는 인상을 주는 대표적 원인이다(§7).
 * 손가락으로 작은 연결점을 집는 것도 실패율이 높아서, 이 모드가 실제로 쓰이는 경로다.
 */
export function setConnectMode(on) {
  connectMode = !!on;
  connectFrom = null;
  if (connectMode) select(null);
  graph.classList.toggle('connecting', connectMode);
  render();
  hooks.onConnectModeChange?.(connectMode);
  return connectMode;
}

export function isConnectMode() { return connectMode; }

function cancelConnect() {
  connectFrom = null;
  render();
}

function tapInConnectMode(id) {
  if (!connectFrom) { connectFrom = id; render(); return; }
  if (connectFrom === id) { cancelConnect(); return; }    // 같은 걸 또 누르면 무른다
  const from = connectFrom;
  connectFrom = null;
  render();
  hooks.onConnect?.(from, id);
}

/** 끄는 동안 보이는 고무줄. drawEdges 가 지우므로 그 뒤에 다시 붙인다. */
function drawWire() {
  if (!wire) { wireEl = null; return; }
  const a = byId(wire.fromId)?.pos;
  if (!a) return;
  if (!wireEl || !wireEl.isConnected) {
    wireEl = document.createElementNS(SVGNS, 'path');
    wireEl.setAttribute('class', 'edge wire');
    svg.appendChild(wireEl);
  }
  wireEl.setAttribute('d', `M ${a[0]} ${a[1]} L ${wire.x} ${wire.y}`);
}

function onWheel(e) {
  e.preventDefault();
  setScale(state.ui.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
}

// ─────────────────────────────────────────── 선택

export function select(id) {
  openEdgeKey = null;
  hideEdgePick();
  touchUI((ui) => { ui.focusId = id; ui.hoverId = null; });
  render();
  hooks.onSelect?.(id);
}

export function toggleShowAll() {
  touchUI((ui) => { ui.showAll = !ui.showAll; });
  openEdgeKey = null;
  render();
  return state.ui.showAll;
}

// ─────────────────────────────────────────── 4단계 — 범례 필터 · 검색

/** 계열 범례에서 끈 것들. 노드는 그대로 두고 **선만** 감춘다. */
export function setHiddenCategories(set) {
  hiddenCats = new Set(set ?? []);
  drawEdges();
}

export function hiddenCategories() { return new Set(hiddenCats); }

/** 검색어에 걸리는 노드에 표시를 붙인다. 초성도 받는다(`ㅈㄴ` → 지나). */
export function setQuery(q) {
  query = String(q ?? '').trim();
  render();
  return state.characters.filter((c) => query && matchesQuery(c.name, query));
}

/** 그 인물이 화면 가운데 오게. 배율은 안 건드린다. */
export function centerOn(id) {
  const c = byId(id);
  if (!c || !Array.isArray(c.pos)) return;
  const r = graph.getBoundingClientRect();
  if (r.width < 40) return;
  state.ui.tx = r.width / 2 - c.pos[0] * state.ui.scale;
  state.ui.ty = r.height / 2 - c.pos[1] * state.ui.scale;
  applyTransform();
}

/** 카드의 줄에 손을 올리면 해당 선이 굵어진다 — 역방향 연결(§7). */
export function setHotRelation(rel) {
  hotKey = rel ? keyOf(rel) : null;
  drawEdges();
}

function openEdge(group) {
  openEdgeKey = group.key;
  drawEdges();
  hooks.onEdgeOpen?.(group.rels);
}

// ─────────────────────────────────────────── 그리기

function focusedId() {
  return state.ui.focusId ?? state.ui.hoverId ?? null;
}

function render() {
  if (!graph) return;
  applyTransform();
  drawNodes();
  drawEdges();
}

function drawNodes() {
  const adj = adjacency();
  const focus = focusedId();
  const related = focus ? adj.get(focus)?.peers ?? new Set() : null;

  const alive = new Set();
  for (const c of state.characters) {
    if (!Array.isArray(c.pos)) continue;
    alive.add(c.id);

    let el = nodeEls.get(c.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = c.id;
      // `.port` 가 연결점이다 — 몸통과 자리가 달라서 이동과 연결이 안 헷갈린다(§7)
      el.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="port" title="끌어서 관계 만들기"></span>';
      nodeLayer.appendChild(el);
      nodeEls.set(c.id, el);
    }
    if (el.querySelector('.nm').textContent !== c.name) el.querySelector('.nm').textContent = c.name;
    el.querySelector('.dot').style.background = groupColor(c);
    if (!drag || drag.id !== c.id) {
      el.style.transform = `translate(${c.pos[0]}px, ${c.pos[1]}px) translate(-50%, -50%)`;
    }
    // 관계가 0인 노드 — 선이 안 보이는 화면에서는 고립된 인물이 안 드러난다(§7)
    el.classList.toggle('lonely', (adj.get(c.id)?.rels.length ?? 0) === 0);
    el.classList.toggle('focus', c.id === focus);
    el.classList.toggle('related', !!related && related.has(c.id));
    el.classList.toggle('connect-from', connectMode && connectFrom === c.id);
    el.classList.toggle('hit', !!query && matchesQuery(c.name, query));
  }
  graph.classList.toggle('searching', !!query);

  for (const [id, el] of nodeEls) {
    if (!alive.has(id)) { el.remove(); nodeEls.delete(id); }
  }

  graph.classList.toggle('focused', !!focus && !state.ui.showAll);
}

/** 같은 두 사람 사이 관계는 **쌍으로 묶는다.** 판정 문제가 사라지고 정보도 더 낫다(§7). */
function keyOf(rel) {
  return rel.idA < rel.idB ? `${rel.idA}|${rel.idB}` : `${rel.idB}|${rel.idA}`;
}

function visibleGroups() {
  const p = parsed();
  const focus = focusedId();
  const groups = new Map();

  for (const rel of p.relations) {
    if (!rel.idA || !rel.idB) continue;
    if (rel.idA === rel.idB) continue;                     // 자기 자신은 그릴 방법이 없다(§6)
    if (hiddenCats.has(rel.category ?? '_unknown')) continue;      // 범례에서 끈 계열
    if (!state.ui.showAll && (!focus || (rel.idA !== focus && rel.idB !== focus))) continue;
    const k = keyOf(rel);
    if (!groups.has(k)) groups.set(k, { key: k, rels: [] });
    groups.get(k).rels.push(rel);
  }
  return [...groups.values()];
}

function quad(p0, c, p1, t) {
  const m = 1 - t;
  return [m * m * p0[0] + 2 * m * t * c[0] + t * t * p1[0], m * m * p0[1] + 2 * m * t * c[1] + t * t * p1[1]];
}

function drawEdges() {
  if (!svg) return;
  const vocab = vocabulary();
  svg.textContent = '';
  labelLayer.textContent = '';
  edges = [];

  const posOf = (id) => (drag && drag.id === id ? [drag.x, drag.y] : byId(id)?.pos);

  for (const g of visibleGroups()) {
    const n = g.rels.length;
    g.rels.forEach((rel, i) => {
      const a = posOf(rel.idA), b = posOf(rel.idB);
      if (!a || !b) return;

      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * PARALLEL_GAP;   // 살짝 휜 평행선(§4)
      const c = [(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off];

      const color = colorOf(vocab, rel.category);
      const dashed = styleOf(vocab, rel.category) !== 'solid';

      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', off === 0
        ? `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`
        : `M ${a[0]} ${a[1]} Q ${c[0]} ${c[1]} ${b[0]} ${b[1]}`);
      path.setAttribute('class', `edge${dashed ? ' dashed' : ''}${hotKey === g.key || openEdgeKey === g.key ? ' hot' : ''}`);
      path.setAttribute('stroke', color);
      svg.appendChild(path);

      // 한쪽 관계 화살표 — 상대 쪽 83% 지점(§7-1)
      if (rel.oneSided) {
        const t = rel.oneSided === 'B' ? 0.83 : 0.17;
        const [ax, ay] = quad(a, c, b, t);
        const [bx, by] = quad(a, c, b, t + (rel.oneSided === 'B' ? 0.02 : -0.02));
        const ang = Math.atan2(by - ay, bx - ax);
        const s = 5;
        const tri = [
          [ax + Math.cos(ang) * s, ay + Math.sin(ang) * s],
          [ax + Math.cos(ang + 2.5) * s, ay + Math.sin(ang + 2.5) * s],
          [ax + Math.cos(ang - 2.5) * s, ay + Math.sin(ang - 2.5) * s],
        ];
        const poly = document.createElementNS(SVGNS, 'polygon');
        poly.setAttribute('points', tri.map((p) => p.join(',')).join(' '));
        poly.setAttribute('fill', color);
        poly.setAttribute('class', 'arrow');
        svg.appendChild(poly);
      }

      // **관계명은 전체 보기이거나 그 선을 눌렀을 때만 나온다**(§7).
      // 「누구와 엮였나」와 「무슨 사이인가」를 분리하는 게 이 설계의 핵심이다.
      if (state.ui.showAll || openEdgeKey === g.key) {
        addLabel(rel.roleA, quad(a, c, b, 0.2), color);
        addLabel(rel.roleB, quad(a, c, b, 0.8), color);
      }

      edges.push({ rel, group: g, a, b, c, curved: off !== 0 });
    });
  }

  drawWire();   // 고무줄은 늘 맨 위에 다시 붙인다
}

function addLabel(role, at, color) {
  if (!role || role.empty) return;      // 한쪽 관계는 빈 쪽 라벨을 안 그린다(§7-1)
  const el = document.createElement('div');
  el.className = 'role-label';
  el.textContent = role.text;           // 수식까지 통째로 — `엄마(의붓)`
  el.style.color = color;
  el.style.transform = `translate(${at[0]}px, ${at[1]}px) translate(-50%, -50%)`;
  labelLayer.appendChild(el);
}

// ─────────────────────────────────────────── 선 최근접 판정(§7)

function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * 히트영역을 겹쳐 까는 흔한 방법은 여기서 답이 아니다 — 겹치면 위에 있는 놈이 무조건
 * 이기고, 그게 사용자가 노린 선이라는 보장이 없다. 대신 **클릭 지점에서 모든 선까지의
 * 거리를 재서 제일 가까운 하나**를 고른다. 겹쳐도 항상 하나가 정해진다.
 *
 * @returns 그룹 | 'ask'(후보 목록을 띄웠다) | null
 */
function pickEdge(clientX, clientY) {
  const p = toGraph(clientX, clientY);
  const scale = state.ui.scale;
  const near = NODE_R + NEAR_NODE;

  // **누른 자리가 노드 근처면 아예 안 받는다.**
  // 9개 선이 균등해도 40도 간격이고, 노드에서 40px 떨어진 지점의 선 간격은 27px다.
  // 상대들이 한쪽에 몰려 20도가 되면 14px로 완전히 겹친다 — 거기서 고르게 하면
  // 「가까운 쪽」이 사실상 아무거나가 되고, 후보 목록만 자꾸 뜬다.
  for (const c of state.characters) {
    if (!Array.isArray(c.pos)) continue;
    if (Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1]) < near) return null;
  }

  const scored = new Map();

  for (const e of edges) {
    // **노드 근처는 판정에서 뺀다.** 상대들이 한쪽에 몰리면 노드 옆에서 선이 완전히 겹친다
    let best = Infinity;
    const N = e.curved ? 24 : 1;
    let prev = e.a;
    for (let i = 1; i <= N; i++) {
      const cur = e.curved ? quad(e.a, e.c, e.b, i / N) : e.b;
      const mid = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2];
      if (Math.hypot(mid[0] - e.a[0], mid[1] - e.a[1]) > near
        && Math.hypot(mid[0] - e.b[0], mid[1] - e.b[1]) > near) {
        best = Math.min(best, distToSegment(p, prev, cur));
      }
      prev = cur;
    }
    if (best === Infinity) continue;
    const cur = scored.get(e.group.key);
    if (!cur || best < cur.d) scored.set(e.group.key, { d: best, group: e.group });
  }

  const ranked = [...scored.values()].sort((x, y) => x.d - y.d);
  if (!ranked.length) return null;
  if (ranked[0].d * scale > HIT_PX) return null;      // 제일 가까운 선도 멀면 빈 곳 클릭

  // 후보 둘의 거리 차가 몇 px 안 되면 작은 목록을 띄운다(§7 ③)
  if (ranked[1] && (ranked[1].d - ranked[0].d) * scale < TIE_PX) {
    showEdgePick(clientX, clientY, ranked.slice(0, 4).map((r) => r.group));
    return 'ask';
  }
  return ranked[0].group;
}

function showEdgePick(clientX, clientY, groups) {
  const box = document.getElementById('edge-pick');
  const r = graph.getBoundingClientRect();
  box.textContent = '';
  for (const g of groups) {
    const a = byId(g.rels[0].idA)?.name ?? '?';
    const b = byId(g.rels[0].idB)?.name ?? '?';
    const btn = document.createElement('button');
    btn.textContent = `${a}-${b}`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); hideEdgePick(); openEdge(g); });
    box.appendChild(btn);
  }
  box.style.left = `${Math.min(clientX - r.left, r.width - 160)}px`;
  box.style.top = `${Math.min(clientY - r.top, r.height - 40 - groups.length * 26)}px`;
  box.classList.add('open');
}

// ─────────────────────────────────────────── SVG 내보내기(§7)

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * **`전체 보기` 상태를 뽑는다.** 기본 상태(노드만)를 뽑으면 점 30개짜리 그림이 나온다.
 * 그래서 화면이 지금 어떤 상태든 상관없이 선과 라벨을 전부 그린 SVG 를 만든다.
 *
 * 노드 크기는 화면에 그려진 실제 상자에서 읽는다 — 한글 폭을 따로 계산하지 않아도 된다.
 */
export function buildSVG({ pad = 60 } = {}) {
  const vocab = vocabulary();
  const chars = state.characters.filter((c) => Array.isArray(c.pos));
  if (!chars.length) return null;

  // 노드 상자 크기 (CSS 픽셀 — transform 은 offsetWidth 에 안 섞인다)
  const box = new Map();
  for (const c of chars) {
    const el = nodeEls.get(c.id);
    box.set(c.id, [el?.offsetWidth || 58, el?.offsetHeight || 24]);
  }

  const xs = chars.flatMap((c) => [c.pos[0] - box.get(c.id)[0] / 2, c.pos[0] + box.get(c.id)[0] / 2]);
  const ys = chars.flatMap((c) => [c.pos[1] - box.get(c.id)[1] / 2, c.pos[1] + box.get(c.id)[1] / 2]);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;

  // 관계를 쌍으로 묶어 평행선을 화면과 같게 벌린다
  const groups = new Map();
  for (const rel of parsed().relations) {
    if (!rel.idA || !rel.idB || rel.idA === rel.idB) continue;
    if (hiddenCats.has(rel.category ?? '_unknown')) continue;
    const k = rel.idA < rel.idB ? `${rel.idA}|${rel.idB}` : `${rel.idB}|${rel.idA}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(rel);
  }

  const edgeParts = [];
  const labelParts = [];

  for (const rels of groups.values()) {
    const n = rels.length;
    rels.forEach((rel, i) => {
      const a = byId(rel.idA).pos, b = byId(rel.idB).pos;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * PARALLEL_GAP;
      const c = [(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off];
      const color = colorOf(vocab, rel.category);
      const dash = styleOf(vocab, rel.category) !== 'solid' ? ' stroke-dasharray="3 2"' : '';
      const d = off === 0 ? `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}` : `M ${a[0]} ${a[1]} Q ${c[0]} ${c[1]} ${b[0]} ${b[1]}`;
      edgeParts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"${dash}/>`);

      if (rel.oneSided) {
        const t = rel.oneSided === 'B' ? 0.83 : 0.17;
        const [ax, ay] = quad(a, c, b, t);
        const [bx, by] = quad(a, c, b, t + (rel.oneSided === 'B' ? 0.02 : -0.02));
        const ang = Math.atan2(by - ay, bx - ax);
        const s = 5;
        const tri = [ang, ang + 2.5, ang - 2.5].map((r) => `${(ax + Math.cos(r) * s).toFixed(1)},${(ay + Math.sin(r) * s).toFixed(1)}`);
        edgeParts.push(`<polygon points="${tri.join(' ')}" fill="${color}"/>`);
      }

      for (const [role, t] of [[rel.roleA, 0.2], [rel.roleB, 0.8]]) {
        if (!role || role.empty) continue;            // 한쪽 관계는 빈 쪽을 안 그린다
        const [lx, ly] = quad(a, c, b, t);
        const tw = role.text.length * 7.4 + 12;       // 한글 폭 어림 — 배경 칩 크기용
        labelParts.push(
          `<g><rect x="${(lx - tw / 2).toFixed(1)}" y="${(ly - 8).toFixed(1)}" width="${tw.toFixed(1)}" height="16" rx="6" fill="rgba(255,255,255,.85)"/>`
          + `<text x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${color}">${esc(role.text)}</text></g>`,
        );
      }
    });
  }

  const nodeParts = chars.map((c) => {
    const [bw, bh] = box.get(c.id);
    const x = c.pos[0] - bw / 2, y = c.pos[1] - bh / 2;
    const lonely = (adjacency().get(c.id)?.rels.length ?? 0) === 0;
    const dot = resolveVar(groupColor(c));
    return `<g>`
      + `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${bh}" rx="6" fill="#fff" `
      + `stroke="${lonely ? '#c9ced6' : '#dfe2e7'}"${lonely ? ' stroke-dasharray="3 2"' : ''}/>`
      + `<circle cx="${(x + 13.5).toFixed(1)}" cy="${c.pos[1].toFixed(1)}" r="3.5" fill="${dot}"/>`
      + `<text x="${(x + 23).toFixed(1)}" y="${(c.pos[1] + 4).toFixed(1)}" font-size="12" font-weight="700" fill="#20242b">${esc(c.name)}</text>`
      + `</g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" `
    + `viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" `
    + `font-family="-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif">\n`
    + `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#fafafa"/>\n`
    + edgeParts.join('\n') + '\n' + nodeParts.join('\n') + '\n' + labelParts.join('\n') + '\n</svg>\n';
}

/** `var(--grp-1)` 같은 값을 실제 색으로 바꾼다 — SVG 파일에는 CSS 변수가 없다. */
function resolveVar(value) {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(String(value ?? '').trim());
  if (!m) return value || '#8a94a3';
  const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return v || '#8a94a3';
}

function hideEdgePick() {
  const box = document.getElementById('edge-pick');
  if (!box) return;
  box.classList.remove('open');
  box.textContent = '';        // 다음에 열 때 옛 후보가 남아 있지 않게
}
