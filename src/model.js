// model.js — 캐릭터 CRUD · id 발번 · 이름 유일성 · 텍스트 반영
//
// 상태를 바꾸는 건 전부 state.mutate() 를 지난다.

import { state, mutate, parsed, byName as findByName, byId as findById } from './state.js?v=20260726b';
import { norm, parseDocument, makeContext } from './parse.js?v=20260726b';
import { mergeRoles } from './roles.js?v=20260726b';
import {
  findLinesWithName, removeLines, renameInLines, replaceLine, serializeRelation,
} from './serialize.js?v=20260726b';

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
