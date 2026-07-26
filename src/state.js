// state.js — 상태 · mutate() · 되돌리기 · 다시그리기 예약
//
// **상태를 바꾸는 모든 자리가 mutate() 를 지난다**(계획서 §10).
// 되돌리기를 나중에 얹으면 그때 코드를 전부 다시 훑어야 하므로 1단계에 넣는다.

import { makeContext, parseDocument } from './parse.js?v=20260726a';
import { mergeRoles } from './roles.js?v=20260726a';

const UNDO_CAP = 50;
const COALESCE_MS = 1500;     // 연달아 들어오는 같은 종류의 편집은 한 덩어리로 본다

export const state = {
  characters: [],             // { id, name, group, color, pos, fields, notes }
  lines: [],                  // 관계 줄. **빈 줄과 주석까지 그대로 담는다**
  nextId: 1,                  // 영구 결번 — 지운 번호를 재활용하지 않는다(§4)

  repoRoles: null,            // src/roles.json (저장소 원본)
  importedRoles: null,        // 가져온 번들 안의 roles
  sessionRoles: [],           // 「'사형'을 목록에 추가」로 이 자리에서 만든 것

  ui: {
    ratio: 65,                // 위/아래 비율. 임시 보관에 같이 들어간다(§7)
    collapsed: null,          // 'graph' | 'list' | null
    showAll: false,           // 전체 보기 토글(§7)
    focusId: null,            // 고정된 인물
    hoverId: null,
    tx: 0, ty: 0, scale: 1,
  },
};

// ─────────────────────────────────────────── 되돌리기

const undoStack = [];
const redoStack = [];
let lastPush = { key: null, at: 0 };

/** 되돌리기 한 번으로 되돌아가는 덩어리 = `1개`. 이 값이 §8 의 변경 개수다. */
let dirty = 0;

function snapshot(s) {
  return {
    characters: s.characters.map((c) => ({ ...c, pos: c.pos ? c.pos.slice() : null, fields: c.fields.map((f) => f.slice()) })),
    lines: s.lines.slice(),
    nextId: s.nextId,
    sessionRoles: s.sessionRoles.slice(),
    // 가져온 어휘는 통째로 교체만 되고 안에서 안 바뀌므로 **참조로 둔다.**
    // 이거 하나로 스냅샷 비용이 수십 KB 씩 줄어든다.
    importedRoles: s.importedRoles,
  };
}

function restore(s, snap) {
  s.characters = snap.characters;
  s.lines = snap.lines;
  s.nextId = snap.nextId;
  s.sessionRoles = snap.sessionRoles;
  s.importedRoles = snap.importedRoles;
}

/**
 * 상태를 바꾸는 유일한 통로.
 *
 * @param {string}   label   되돌리기 목록에 뜰 이름
 * @param {function} fn      (state) => void
 * @param {object}   opts    { coalesce } — 같은 키가 1.5초 안에 또 오면 한 덩어리로 친다.
 *                           타이핑이 매 글자마다 되돌리기 한 칸이 되는 걸 막는다(§8)
 */
export function mutate(label, fn, opts = {}) {
  const key = opts.coalesce ?? null;
  const now = Date.now();
  const merge = key !== null && lastPush.key === key && now - lastPush.at < COALESCE_MS && undoStack.length > 0;

  if (!merge) {
    undoStack.push({ label, snap: snapshot(state) });
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    dirty++;
  }
  lastPush = { key, at: now };
  redoStack.length = 0;

  const result = fn(state);
  invalidate();
  return result;
}

/** 되돌리기 없이 화면 상태만 바꾼다 (선택·확대·비율 — 데이터가 아니다). */
export function touchUI(fn) {
  fn(state.ui);
  invalidate({ uiOnly: true });
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function undoLabel() { return undoStack.at(-1)?.label ?? null; }

export function undo() {
  const e = undoStack.pop();
  if (!e) return false;
  redoStack.push({ label: e.label, snap: snapshot(state) });
  restore(state, e.snap);
  dirty++;
  lastPush = { key: null, at: 0 };
  invalidate();
  return true;
}

export function redo() {
  const e = redoStack.pop();
  if (!e) return false;
  undoStack.push({ label: e.label, snap: snapshot(state) });
  restore(state, e.snap);
  dirty++;
  lastPush = { key: null, at: 0 };
  invalidate();
  return true;
}

/** 마지막 내보내기 이후 변경 개수. **내보내기가 유일한 영구 기록이다**(§8). */
export function dirtyCount() { return dirty; }
export function markExported() { dirty = 0; invalidate({ uiOnly: true }); }
export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  lastPush = { key: null, at: 0 };
}

/**
 * 부팅 때 상태를 채워 넣는다 — 되돌리기 기록도 변경 개수도 안 만든다.
 * 「지난 작업 이어하기」는 사용자가 한 편집이 아니므로 `1개` 로 세면 안 된다(§8).
 */
export function hydrate(fn, { dirty: d = 0 } = {}) {
  fn(state);
  resetHistory();
  dirty = d;
  invalidate();
}

// ─────────────────────────────────────────── 파생값 (다시 계산은 한 번만)

let revision = 0;
let memo = { rev: -1 };

function invalidate(opts = {}) {
  if (!opts.uiOnly) { revision++; memo = { rev: -1 }; }
  schedule();
}

/** 병합된 어휘 — 저장소 > 가져온 것 > 세션. **겹치면 저장소가 이긴다**(§5). */
export function vocabulary() {
  build();
  return memo.vocab;
}

/** parse.js 에 넘길 문맥. */
export function parseCtx() {
  build();
  return memo.ctx;
}

/** 지금 텍스트의 파싱 결과. 줄·이름·어휘가 바뀔 때만 다시 판다. */
export function parsed() {
  build();
  return memo.parsed;
}

/** 인접목록 — 초점이 바뀔 때 클래스만 토글하려고 **미리** 만들어 둔다(§7). */
export function adjacency() {
  build();
  return memo.adj;
}

export function byName(name) {
  build();
  return memo.byName.get(String(name ?? '').normalize('NFC').trim()) ?? null;
}

export function byId(id) {
  build();
  return memo.byId.get(id) ?? null;
}

function build() {
  if (memo.rev === revision) return;

  const vocab = mergeRoles(state.repoRoles, state.importedRoles, state.sessionRoles);

  const byNameMap = new Map();
  const byIdMap = new Map();
  for (const c of state.characters) {
    byNameMap.set(c.name, c);
    byIdMap.set(c.id, c);
  }

  const ctx = makeContext({ names: state.characters.map((c) => c.name), rolesDoc: vocab.doc });
  const p = parseDocument(state.lines, ctx);

  // 인접목록 · 인물별 관계 줄
  const adj = new Map();
  for (const c of state.characters) adj.set(c.id, { peers: new Set(), rels: [] });
  for (const r of p.relations) {
    const a = byNameMap.get(r.nameA);
    const b = byNameMap.get(r.nameB);
    if (!a || !b) continue;
    r.idA = a.id;
    r.idB = b.id;
    adj.get(a.id).rels.push(r);
    if (a.id !== b.id) {
      adj.get(b.id).rels.push(r);
      adj.get(a.id).peers.add(b.id);
      adj.get(b.id).peers.add(a.id);
    }
  }

  memo = { rev: revision, vocab, ctx, parsed: p, adj, byName: byNameMap, byId: byIdMap };
}

// ─────────────────────────────────────────── 다시그리기 · 저장 예약

const listeners = new Set();
let frame = 0;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function schedule() {
  // 저장 예약은 **그리기와 분리한다.** 한 프레임 안에 여러 번 바뀌어도 그리기는
  // 한 번이면 되지만, 그때 저장까지 같이 건너뛰면 탭이 뒤에 있는 동안(그래서
  // rAF 가 안 오는 동안) 쌓인 변경이 하나도 안 남는다.
  scheduleSave();
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const fn of listeners) fn();
  });
}

// io.js 가 실제 저장 함수를 여기 꽂는다. state.js 는 localStorage 를 모른다.
let saver = null;
let saveTimer = 0;

export function setSaver(fn) { saver = fn; }

/**
 * **쓰기 시점은 §8 의 `1개` 단위와 같다.** 드래그하는 동안 프레임마다 부르면
 * 50KB 를 초당 60번 쓰게 되고 아이패드에서 눈에 띄게 버벅인다.
 */
function scheduleSave() {
  if (!saver) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saver(), 500);
}

export function flushSave() {
  if (!saver) return;
  clearTimeout(saveTimer);
  saver();
}
