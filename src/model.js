// model.js — 캐릭터 CRUD · id 발번 · 이름 유일성 · 텍스트 반영
//
// 상태를 바꾸는 건 전부 state.mutate() 를 지난다.

import { state, mutate, parsed, byName as findByName, byId as findById } from './state.js?v=20260726f';
import { norm, parseDocument, makeContext } from './parse.js?v=20260726f';
import { mergeRoles } from './roles.js?v=20260726f';
import {
  findLinesWithName, removeLines, renameInLines, replaceLine, serializeRelation,
} from './serialize.js?v=20260726f';

// ─────────────────────────────────────────── id — 영구 결번(§4)

/** `P01`~`P99` 순번. 관계 사전이 쓰는 형식 그대로다. **지운 번호는 다시 쓰지 않는다.** */
export function formatId(n) {
  return n < 100 ? `P${String(n).padStart(2, '0')}` : `P${n}`;
}

function issueId(s) {
  const id = formatId(s.nextId);
  s.nextId += 1;
  return id;
}

// ─────────────────────────────────────────── 이름 유일성(§4)

/** 비교는 NFC 정규화 + 앞뒤 공백 제거 후에 한다. 눈에 같아 보이면 같은 것으로 친다. */
export function nameTaken(name, exceptId = null) {
  const t = norm(name);
  return state.characters.some((c) => c.name === t && c.id !== exceptId);
}

/** 가져오기 전용 — 겹치면 막지 말고 뒤엣것에 `-2` 를 붙인다(§4). */
export function uniquify(name, taken) {
  let base = norm(name) || '이름없음';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ─────────────────────────────────────────── 배치

/**
 * 텍스트로 자동 생성된 캐릭터를 **겹치지 않게 흩는다**(§7).
 * 기본값을 그대로 쓰면 전부 같은 자리에 쌓여 한 명처럼 보인다.
 */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function centroid(chars) {
  const withPos = chars.filter((c) => Array.isArray(c.pos));
  if (!withPos.length) return [480, 300];
  let x = 0, y = 0;
  for (const c of withPos) { x += c.pos[0]; y += c.pos[1]; }
  return [Math.round(x / withPos.length), Math.round(y / withPos.length)];
}

export function spiralPos(index, center) {
  const r = 26 * Math.sqrt(index + 1) + 40;
  const a = (index + 1) * GOLDEN;
  return [Math.round(center[0] + r * Math.cos(a)), Math.round(center[1] + r * Math.sin(a) * 0.72)];
}

function placeNew(s) {
  const center = centroid(s.characters);
  let slot = s.characters.filter((c) => Array.isArray(c.pos)).length;
  for (const c of s.characters) {
    if (!Array.isArray(c.pos)) { c.pos = spiralPos(slot, center); slot++; }
  }
}

// ─────────────────────────────────────────── 소속 색(§5 — 세력은 노드 색이 맡는다)

const GROUP_VARS = ['--grp-0', '--grp-1', '--grp-2', '--grp-3', '--grp-4', '--grp-5'];

export function groupColor(character) {
  if (character.color) return character.color;
  const g = character.group;
  if (!g) return 'var(--grp-2)';
  const groups = [...new Set(state.characters.map((c) => c.group).filter(Boolean))].sort();
  const i = groups.indexOf(g);
  return `var(${GROUP_VARS[(i < 0 ? 0 : i) % GROUP_VARS.length]})`;
}

// ─────────────────────────────────────────── 만들기 · 고치기 · 지우기

function blank(id, name, pos) {
  return { id, name: norm(name), group: null, color: null, pos: pos ?? null, fields: [], notes: '' };
}

/** @returns {{ ok: boolean, error?: string, character?: object }} */
export function addCharacter(name, pos = null) {
  const t = norm(name);
  if (!t) return { ok: false, error: '이름이 비었습니다' };
  if (nameTaken(t)) return { ok: false, error: `'${t}' 는 이미 있습니다. 이름은 겹칠 수 없습니다` };

  return mutate(`캐릭터 추가 — ${t}`, (s) => {
    const c = blank(issueId(s), t, pos);
    s.characters.push(c);
    if (!c.pos) placeNew(s);
    return { ok: true, character: c };
  });
}

/**
 * 이름 변경은 「**해당 줄들을 줄 단위로 교체하는 작업**」이다(§4).
 * 먼저 이걸로 미리보기를 받아 보여주고, 확인하면 applyRename() 을 부른다.
 */
export function previewRename(id, newName) {
  const c = findById(id);
  if (!c) return { ok: false, error: '없는 캐릭터입니다' };
  const t = norm(newName);
  if (!t) return { ok: false, error: '이름이 비었습니다' };
  if (t === c.name) return { ok: false, error: '같은 이름입니다' };
  if (nameTaken(t, id)) return { ok: false, error: `'${t}' 는 이미 있습니다. 이름은 겹칠 수 없습니다` };

  const { preview } = renameInLines(state.lines, parsed().entries, c.name, t);
  return { ok: true, from: c.name, to: t, preview };
}

export function applyRename(id, newName) {
  const pre = previewRename(id, newName);
  if (!pre.ok) return pre;

  mutate(`이름 변경 — ${pre.from} → ${pre.to}`, (s) => {
    const c = s.characters.find((x) => x.id === id);
    const { lines } = renameInLines(s.lines, parsed().entries, pre.from, pre.to);
    c.name = pre.to;
    s.lines = lines;
  });
  return pre;
}

/**
 * **캐릭터를 지우면 그 사람이 낀 관계 줄도 함께 지운다**(§4).
 * 남겨두면 지운 사람이 텍스트에 살아 있다가 다음 파싱에서 자동 생성으로 되살아난다.
 * 대신 소리 없이 지우지 않는다 — 이걸로 미리 보여준다.
 */
export function previewDelete(id) {
  const c = findById(id);
  if (!c) return { ok: false, error: '없는 캐릭터입니다' };
  const idx = findLinesWithName(parsed().entries, c.name);
  return { ok: true, name: c.name, indices: idx, lines: idx.map((i) => state.lines[i]) };
}

export function applyDelete(id) {
  const pre = previewDelete(id);
  if (!pre.ok) return pre;

  // 캐릭터와 딸린 줄은 **한 동작이지 두 동작이 아니다.** 되돌리기 한 번에 같이 돌아온다.
  mutate(`캐릭터 삭제 — ${pre.name}`, (s) => {
    s.characters = s.characters.filter((x) => x.id !== id);
    s.lines = removeLines(s.lines, pre.indices);
    if (s.ui.focusId === id) s.ui.focusId = null;
  });
  return pre;
}

export function moveCharacter(id, x, y) {
  // 드래그는 **놓았을 때** 한 번만 부른다 — 그게 §8 의 `1개` 단위다.
  mutate('노드 이동', (s) => {
    const c = s.characters.find((x2) => x2.id === id);
    if (c) c.pos = [Math.round(x), Math.round(y)];
  }, { coalesce: null });
}

export function setGroup(id, group) {
  mutate('소속 변경', (s) => {
    const c = s.characters.find((x) => x.id === id);
    if (c) c.group = norm(group) || null;
  });
}

/**
 * 시트에서 고친 것을 한 번에 반영한다.
 * **이름은 여기서 안 받는다** — 이름 변경은 관계 줄을 줄 단위로 갈아끼우는
 * 별개의 작업이고 미리보기와 확인을 거쳐야 한다(§4). applyRename() 을 쓴다.
 *
 * 시트를 한 번 저장하는 게 되돌리기 `1개` 다(§8).
 */
export function updateCharacter(id, patch) {
  const c = findById(id);
  if (!c) return { ok: false, error: '없는 캐릭터입니다' };

  mutate(`시트 저장 — ${c.name}`, (s) => {
    const t = s.characters.find((x) => x.id === id);
    if (!t) return;
    if ('group' in patch) t.group = norm(patch.group) || null;
    if ('color' in patch) t.color = patch.color || null;
    if ('notes' in patch) t.notes = norm(patch.notes);
    if ('fields' in patch) {
      // **순서 있는 쌍의 목록이다**(§4). 객체로 바꾸면 순서를 잃는다
      t.fields = patch.fields
        .map(([k, v]) => [norm(k), norm(v)])
        .filter(([k, v]) => k !== '' || v !== '');
    }
  });
  return { ok: true };
}

/** 지금 쓰이는 소속 목록 — 시트의 자동완성에 쓴다. */
export function groupNames() {
  return [...new Set(state.characters.map((c) => c.group).filter(Boolean))].sort();
}

// ─────────────────────────────────────────── `정리` 배치(§7)
//
// **배치는 자동으로 계속 움직이지 않는다.** 물리 시뮬레이션은 사용자가 놓은 자리를
// 계속 밀어내서 싸움이 된다. 눌렀을 때만 **정해진 횟수만큼 돌고 멈춘다.**
//
// 한 번 누른 결과가 마음에 안 들면 되돌리기 한 번으로 원래 자리로 간다 —
// 그래서 「자동으로 계속」이 아니라 「눌렀을 때 한 번」이 안전한 선택이 된다.

const TIDY_STEPS = 260;
const LINK_LEN = 165;        // 이어진 사람끼리 목표 거리
const MIN_GAP = 92;          // 안 이어진 사람끼리 최소 거리 — 30명 밀도 문제(§7-1)

export function tidyLayout() {
  const chars = state.characters.filter((c) => Array.isArray(c.pos));
  if (chars.length < 2) return { ok: false, error: '옮길 인물이 없습니다' };

  const idx = new Map(chars.map((c, i) => [c.id, i]));
  const pts = chars.map((c) => [c.pos[0], c.pos[1]]);

  // 인접목록에서 간선을 뽑는다 (같은 쌍은 한 번만)
  const seen = new Set();
  const links = [];
  for (const rel of parsed().relations) {
    if (!rel.idA || !rel.idB || rel.idA === rel.idB) continue;
    const a = idx.get(rel.idA), b = idx.get(rel.idB);
    if (a === undefined || b === undefined) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([a, b]);
  }

  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;

  for (let step = 0; step < TIDY_STEPS; step++) {
    const cool = 1 - step / TIDY_STEPS;          // 식으면서 멈춘다
    const fx = new Array(pts.length).fill(0);
    const fy = new Array(pts.length).fill(0);

    // 서로 밀기 — 겹치지 않게
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[i][0] - pts[j][0];
        let dy = (pts[i][1] - pts[j][1]) * 1.6;   // 세로를 더 아끼면 가로로 퍼진다
        let d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = (i % 2 ? 1 : -1) * 0.7; dy = 0.7; d = 1; }
        if (d > MIN_GAP * 3) continue;
        const f = (MIN_GAP * MIN_GAP) / (d * d) * 2.4;
        fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f;
      }
    }

    // 이어진 것끼리 당기기
    for (const [a, b] of links) {
      const dx = pts[b][0] - pts[a][0];
      const dy = pts[b][1] - pts[a][1];
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - LINK_LEN) * 0.045;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    }

    // 아무하고도 안 엮인 사람이 무한히 날아가지 않게 가운데로 살짝
    for (let i = 0; i < pts.length; i++) {
      fx[i] += (cx - pts[i][0]) * 0.006;
      fy[i] += (cy - pts[i][1]) * 0.006;
      const cap = 22 * cool;
      pts[i][0] += Math.max(-cap, Math.min(cap, fx[i]));
      pts[i][1] += Math.max(-cap, Math.min(cap, fy[i]));
    }
  }

  return mutate('정리', (s) => {
    for (const c of s.characters) {
      const i = idx.get(c.id);
      if (i !== undefined) c.pos = [Math.round(pts[i][0]), Math.round(pts[i][1])];
    }
    return { ok: true, moved: chars.length };
  });
}

// ─────────────────────────────────────────── 텍스트 반영

/**
 * 텍스트가 바뀌었을 때의 유일한 통로.
 * 줄을 넣고, 그 자리에서 파싱해 **새로 나온 이름을 캐릭터로 만든다**(§6-3).
 * 둘이 한 mutate 안에 있어야 되돌리기가 한 번에 돌아간다.
 */
export function applyLines(lines, { coalesce = 'text' } = {}) {
  mutate('텍스트 편집', (s) => {
    s.lines = lines;

    // state.vocabulary() 는 memo 를 세우느라 파싱을 한 번 더 돌린다.
    // 여기서는 어휘만 있으면 되므로 직접 합친다.
    const doc = mergeRoles(s.repoRoles, s.importedRoles, s.sessionRoles).doc;
    const ctx = makeContext({ names: s.characters.map((c) => c.name), rolesDoc: doc });
    const p = parseDocument(lines, ctx);
    if (!p.newNames.length) return;

    for (const n of p.newNames) {
      if (s.characters.some((c) => c.name === n)) continue;
      s.characters.push(blank(issueId(s), n, null));
    }
    placeNew(s);
  }, { coalesce });
}

// ─────────────────────────────────────────── 관계 줄 — 줄 단위로만 건드린다(§4)
//
// > 관계 내용의 원본은 텍스트다. 관계도에서 편집하면 해당 **줄 하나만 갈아끼운다.**
// > 문서 전체를 다시 써내는 일은 없다.
//
// 이걸 안 지키면 두 화면이 서로 덮어쓰기 시작한다.

/** 관계도에서 새로 만든 관계 — 텍스트 **맨 끝에 한 줄** 붙인다. */
export function appendRelationLine(nameA, nameB, roleA, roleB) {
  const line = serializeRelation({
    nameA, nameB,
    roleA: { text: roleA ?? '' , empty: !(roleA ?? '') },
    roleB: { text: roleB ?? '' , empty: !(roleB ?? '') },
  });
  return mutate(`관계 추가 — ${nameA}-${nameB}`, (s) => {
    // 끝이 빈 줄이면 그 앞에 넣어 파일이 지저분해지지 않게 한다
    const at = s.lines.length && s.lines.at(-1).trim() === '' ? s.lines.length - 1 : s.lines.length;
    s.lines = [...s.lines.slice(0, at), line, ...s.lines.slice(at)];
    return { line, index: at };
  });
}

/** 이미 있는 줄의 역할만 바꾼다. **그 줄 하나만** 갈아끼운다. */
export function replaceRelationLine(lineIndex, roleA, roleB) {
  const e = parsed().entries[lineIndex];
  if (!e || e.kind !== 'relation' || !e.ok) return { ok: false, error: '관계 줄이 아닙니다' };

  const line = serializeRelation({
    nameA: e.nameA, nameB: e.nameB,
    roleA: { text: roleA ?? '', empty: !(roleA ?? '') },
    roleB: { text: roleB ?? '', empty: !(roleB ?? '') },
  });
  mutate(`관계 수정 — ${e.nameA}-${e.nameB}`, (s) => {
    s.lines = replaceLine(s.lines, lineIndex, line);
  });
  return { ok: true, line };
}

/** 관계 한 건 지우기 — **그 줄만** 지운다. 빈 줄과 주석은 안 건드린다. */
export function deleteRelationLine(lineIndex) {
  const e = parsed().entries[lineIndex];
  if (!e || e.kind !== 'relation') return { ok: false, error: '관계 줄이 아닙니다' };
  const before = state.lines[lineIndex];
  mutate(`관계 삭제 — ${before}`, (s) => {
    s.lines = removeLines(s.lines, [lineIndex]);
  });
  return { ok: true, removed: before };
}

// ─────────────────────────────────────────── 가져오기 반영

/**
 * 번들을 상태에 얹는다. **가져오기는 지금 화면을 통째로 갈아치우는 동작이다** —
 * 부르기 전에 비교를 보여주고 확인을 받는다(§8).
 *
 * @returns {{ renamed: [string,string][] }}
 */
export function loadBundle(unpacked) {
  const renamed = [];
  return mutate('가져오기', (s) => {
    const taken = new Set();
    const chars = unpacked.characters.map((c) => {
      const name = uniquify(c.name, taken);
      if (name !== c.name) renamed.push([c.name, name]);
      taken.add(name);
      return { ...c, name };
    });

    s.characters = chars;
    s.lines = unpacked.lines;
    s.importedRoles = unpacked.roles;
    s.sessionRoles = [];
    s.nextId = Math.max(unpacked.nextId ?? 1, maxIdOf(chars) + 1);
    s.ui.focusId = null;
    placeNew(s);
    return { renamed };
  });
}

function maxIdOf(chars) {
  let m = 0;
  for (const c of chars) {
    const g = /^P(\d+)$/.exec(String(c.id ?? ''));
    if (g) m = Math.max(m, Number(g[1]));
  }
  return m;
}

/** 「'사형'을 목록에 추가」 — 입력을 막는 어휘는 일주일이면 안 쓰게 된다(§5). */
export function addSessionRole(label, categoryId, { pair = 'symmetric', tier = 1 } = {}) {
  const t = norm(label);
  if (!t) return { ok: false, error: '관계명이 비었습니다' };
  if (/[()]/.test(t)) return { ok: false, error: '관계명에는 괄호를 쓸 수 없습니다. 수식으로 오독됩니다' };
  if (/[-:]/.test(t)) return { ok: false, error: '관계명에는 `-` 와 `:` 를 쓸 수 없습니다. 구분자와 부딪힙니다' };

  mutate(`어휘 추가 — ${t}`, (s) => {
    s.sessionRoles.push({
      id: `r_x_${Date.now().toString(36)}`,
      label: t, en: null, category: categoryId, tier, pair,
    });
  });
  return { ok: true };
}

export { findByName, findById };
