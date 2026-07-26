// serialize.js — 관계 → 줄 · 줄 단위 교체 · 번들 묶기/풀기
//
// ★ parse.js 와 같이 아무것도 import 하지 않는다. (CLAUDE.md 참조)
//   그래야 node 러너가 이 파일까지 그대로 읽는다.
//
// 두 화면의 권한 규칙(§4): 관계 내용의 원본은 텍스트다.
//   여기 있는 함수는 **줄 하나만 갈아끼운다.** 문서 전체를 다시 써내지 않는다.

const NFC = (s) => (typeof s === 'string' ? s.normalize('NFC') : s);
const N = (s) => NFC(String(s ?? '')).trim();

// ─────────────────────────────────────────── 이름 따옴표

/** `-` `:` 괄호 따옴표가 들었거나 앞뒤 공백이 있으면 감싼다(§6-4). 한 번 감싸두면 영원히 안 헷갈린다. */
export function needsQuote(name) {
  const s = String(name ?? '');
  return /[-:()"]/.test(s) || s !== s.trim() || s === '';
}

export function quoteName(name) {
  const s = String(name ?? '');
  return needsQuote(s) ? `"${s.replace(/"/g, '')}"` : s;
}

// ─────────────────────────────────────────── 역할

/**
 * 역할 한 칸을 글자로. **사용자가 쓴 말을 그대로 둔다** — `오빠`를 `형`으로 고쳐 쓰지 않는다(§7-1).
 * role 은 parse.js 의 resolveRole() 결과이거나 { base, mods } 이면 된다.
 */
export function serializeRole(role) {
  if (!role) return '';
  if (role.empty) return '';
  if (typeof role.text === 'string' && role.text !== '') return role.text;
  const base = N(role.base ?? role.label ?? '');
  if (base === '') return '';
  const mods = (role.mods ?? []).map(N).filter(Boolean);
  return mods.length ? `${base}(${mods.join(', ')})` : base;
}

/**
 * `지나-당옥 : 딸 - 엄마` / 한쪽 관계는 `지나-선 : 짝사랑 -` · `지나-선 : - 짝사랑`
 * 빈 쪽이 있어도 공백이 겹치지 않게 앞뒤만 턴다.
 */
export function serializeRelation(rel) {
  const a = quoteName(N(rel.nameA));
  const b = quoteName(N(rel.nameB));
  const ra = serializeRole(rel.roleA);
  const rb = serializeRole(rel.roleB);
  const tail = `${ra} - ${rb}`.replace(/^\s+/, '').replace(/\s+$/, '');
  return `${a}-${b} : ${tail}`;
}

// ─────────────────────────────────────────── 줄 단위 조작

/** 그 줄 하나만 바꾼 **새 배열**을 준다. */
export function replaceLine(lines, index, newLine) {
  if (index < 0 || index >= lines.length) return lines.slice();
  const out = lines.slice();
  out[index] = newLine;
  return out;
}

/** 지정한 줄들만 지운다. **빈 줄과 주석은 건드리지 않는다**(§4). */
export function removeLines(lines, indices) {
  const drop = new Set(indices);
  return lines.filter((_, i) => !drop.has(i));
}

/**
 * 이름이 걸린 관계 줄을 찾는다. **주석 안의 이름은 안 센다**(§4).
 * @param entries parseDocument().entries
 */
export function findLinesWithName(entries, name) {
  const target = N(name);
  const out = [];
  for (const e of entries) {
    if (e.kind !== 'relation' || !e.ok) continue;
    if (e.nameA === target || e.nameB === target) out.push(e.lineIndex);
  }
  return out;
}

/**
 * 이름 변경 — **해당 줄들을 줄 단위로 교체하는 작업**이다(§4).
 * 바꿀 줄을 먼저 보여주고 확인받은 뒤 이걸 부른다.
 * 역할 쪽 글자는 사용자가 쓴 그대로 옮긴다.
 *
 * @returns {{ lines, changed: number[], preview: {index, before, after}[] }}
 */
export function renameInLines(lines, entries, oldName, newName) {
  const from = N(oldName);
  const to = N(newName);
  const out = lines.slice();
  const changed = [];
  const preview = [];

  for (const e of entries) {
    if (e.kind !== 'relation' || !e.ok) continue;
    if (e.nameA !== from && e.nameB !== from) continue;
    const next = serializeRelation({
      nameA: e.nameA === from ? to : e.nameA,
      nameB: e.nameB === from ? to : e.nameB,
      roleA: e.roleA,
      roleB: e.roleB,
    });
    preview.push({ index: e.lineIndex, before: lines[e.lineIndex], after: next });
    out[e.lineIndex] = next;
    changed.push(e.lineIndex);
  }
  return { lines: out, changed, preview };
}

// ─────────────────────────────────────────── 번들

export const BUNDLE_FORMAT = 'charmap';
export const BUNDLE_VERSION = 1;

function pad(n) { return String(n).padStart(2, '0'); }

/** `charmap-20260726-1840.json` — 목록이 저절로 시간순으로 정렬된다(§8). */
export function bundleFileName(date = new Date()) {
  return `charmap-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

function isoLocal(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/**
 * 관계 줄은 **줄 배열로** 담는다 — 한 줄로 뭉개지면 제일 자주 볼 부분이 제일 안 읽힌다.
 * 빈 줄과 주석까지 그대로 보존된다(§8).
 *
 * `nextId` 는 계획서 §8 형식에 없던 칸이다. 없으면 「지운 번호는 영구 결번」(§4)이
 * 깨진다 — 제일 큰 번호를 지우는 순간 최댓값+1 이 그 번호를 재활용한다.
 */
export function packBundle({ characters = [], lines = [], roles = null, nextId = null }, date = new Date()) {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: isoLocal(date),
    nextId: nextId ?? nextIdFrom(characters),
    characters: characters.map((c) => ({
      id: c.id,
      name: N(c.name),
      group: c.group == null ? null : N(c.group),
      color: c.color ?? null,
      pos: Array.isArray(c.pos) ? [Math.round(c.pos[0]), Math.round(c.pos[1])] : [0, 0],
      fields: (c.fields ?? []).map(([k, v]) => [N(k), NFC(String(v ?? ''))]),
      notes: NFC(String(c.notes ?? '')),
    })),
    relationLines: lines.map((l) => NFC(String(l ?? ''))),
    roles: roles ?? { categories: [], modifiers: [], roles: [] },
  };
}

export function nextIdFrom(characters) {
  let max = 0;
  for (const c of characters ?? []) {
    const m = /^P(\d+)$/.exec(String(c.id ?? ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * 번들을 푼다. **이름을 안 보고 내용의 format·version·exportedAt 만 본다**(§8).
 * 읽는 즉시 NFC 정규화한다 — 아이패드에서 만든 파일이 주 경로다(§4).
 *
 * @returns {{ ok, error?, characters, lines, roles, nextId, exportedAt }}
 */
export function unpackBundle(obj) {
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'JSON 객체가 아닙니다' };
  }
  if (obj.format !== BUNDLE_FORMAT) {
    return { ok: false, error: `charmap 번들이 아닙니다 (format: ${JSON.stringify(obj.format)})` };
  }
  if (Number(obj.version) > BUNDLE_VERSION) {
    return { ok: false, error: `이 앱보다 새 형식입니다 (version ${obj.version}). 앱을 새로고침해 보세요` };
  }

  const characters = (Array.isArray(obj.characters) ? obj.characters : []).map((c, i) => ({
    id: String(c?.id ?? `P${String(i + 1).padStart(2, '0')}`),
    name: N(c?.name),
    group: c?.group == null ? null : N(c.group),
    color: c?.color ?? null,
    pos: Array.isArray(c?.pos) && c.pos.length === 2 ? [Number(c.pos[0]) || 0, Number(c.pos[1]) || 0] : null,
    fields: Array.isArray(c?.fields)
      ? c.fields.filter(Array.isArray).map(([k, v]) => [N(k), NFC(String(v ?? ''))])
      : [],
    notes: NFC(String(c?.notes ?? '')),
  }));

  const lines = Array.isArray(obj.relationLines)
    ? obj.relationLines.map((l) => NFC(String(l ?? '')))
    : [];

  return {
    ok: true,
    characters,
    lines,
    roles: obj.roles && typeof obj.roles === 'object' ? obj.roles : null,
    // 없는 파일(옛 번들·손으로 만든 것)이면 최댓값+1 로 물러선다
    nextId: Number.isFinite(obj.nextId) ? Number(obj.nextId) : nextIdFrom(characters),
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
  };
}
