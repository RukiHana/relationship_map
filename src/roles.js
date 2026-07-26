// roles.js — 어휘 병합 · 조회 · 계열 색
//
// 어휘가 사는 곳이 셋이라 병합 규칙이 필요하다(계획서 §5):
//   1. src/roles.json          저장소 원본. 손으로 고치는 곳
//   2. 가져온 번들의 roles      그 데이터를 만들 때 쓰던 목록
//   3. 세션에서 버튼으로 추가   「'사형'을 목록에 추가」
//
// **규칙 — 합치되, 겹치면 저장소 파일이 이긴다.**

import { norm, buildRoleIndex } from './parse.js?v=20260726b';

const FALLBACK_CATEGORY = {
  id: '_unknown', label: '분류 없음', tier: 1, color: '#b6bcc4', style: 'solid',
};

/** 한 항목이 차지하는 이름 전부 — label 과 aliases. 맞추는 기준은 id 가 아니라 **이름**이다(§5). */
function keysOf(role) {
  const out = [norm(role.label)];
  for (const a of role.aliases ?? []) {
    const k = norm(a);
    if (k) out.push(k);
  }
  return out.filter(Boolean);
}

/**
 * @returns {{ doc, index, temp: Set<string>, tempRoles: object[] }}
 *   temp — 저장소에 없는 어휘의 label. 화면에서 「임시」로 표시한다(§5).
 */
export function mergeRoles(repoDoc, importedDoc, sessionRoles = []) {
  const categories = [];
  const catIds = new Set();
  const roles = [];
  const takenKeys = new Set();
  const takenIds = new Set();
  const temp = new Set();

  const addCategories = (doc) => {
    for (const c of doc?.categories ?? []) {
      if (!c?.id || catIds.has(c.id)) continue;
      catIds.add(c.id);
      categories.push(c);
    }
  };

  const addRoles = (doc, { isTemp }) => {
    for (const r of (Array.isArray(doc) ? doc : doc?.roles) ?? []) {
      if (!r?.label) continue;
      const keys = keysOf(r);
      // 이름이 하나라도 이미 잡혀 있으면 **저장소 쪽 정의를 쓴다** — 얹지 않는다
      if (keys.some((k) => takenKeys.has(k))) continue;

      let id = r.id ?? `r_${keys[0]}`;
      if (takenIds.has(id)) {           // id 가 겹치면 얹히는 쪽에 접미사를 붙여 피한다
        let n = 2;
        while (takenIds.has(`${id}_${n}`)) n++;
        id = `${id}_${n}`;
      }
      takenIds.add(id);
      for (const k of keys) takenKeys.add(k);

      const copy = { ...r, id };
      if (isTemp) { copy.temp = true; temp.add(norm(r.label)); }
      roles.push(copy);
    }
  };

  // 1. 저장소를 먼저 깐다
  addCategories(repoDoc);
  addRoles(repoDoc, { isTemp: false });

  // 2. 가져온 파일의 어휘 중 **저장소에 없는 것만** 얹는다
  addCategories(importedDoc);
  addRoles(importedDoc, { isTemp: true });

  // 3. 이 자리에서 추가한 것
  addRoles(sessionRoles, { isTemp: true });

  const modifiers = (repoDoc?.modifiers?.length ? repoDoc.modifiers : importedDoc?.modifiers) ?? [];
  const modifiersEn = repoDoc?.modifiersEn ?? importedDoc?.modifiersEn ?? {};

  const doc = { categories, modifiers, modifiersEn, roles };
  return {
    doc,
    index: buildRoleIndex(doc),
    temp,
    tempRoles: roles.filter((r) => r.temp),
  };
}

// ─────────────────────────────────────────── 조회

export function categoryOf(vocab, catId) {
  if (!catId) return FALLBACK_CATEGORY;
  for (const c of vocab.doc.categories) if (c.id === catId) return c;
  return FALLBACK_CATEGORY;
}

/** 관계선 색. **roles.json 에 없는 말은 회색으로 떨어진다**(§5). */
export function colorOf(vocab, catId) {
  return categoryOf(vocab, catId).color;
}

export function styleOf(vocab, catId) {
  return categoryOf(vocab, catId).style ?? 'solid';
}

export function roleByLabel(vocab, label) {
  return vocab.index.roles.get(norm(label)) ?? null;
}

/**
 * 역방향 자동 제안. `pair` 는 **강제가 아니라 제안**이므로 틀려도 손해가 없다(§5).
 *
 * 성별 칸을 두지 않기로 했으므로(§12) `딸`의 짝이 엄마인지 아빠인지는
 * **상대가 이미 가진 다른 관계에서 읽는다** — 당옥이 누군가의 `엄마`로 적혀 있으면
 * `엄마`를 먼저 올린다. 단서가 없으면 그때만 둘 다 보여준다.
 */
export function suggestPair(vocab, label, otherPersonRoles = []) {
  const role = roleByLabel(vocab, label);
  if (!role) return [];
  const p = role.pair;
  if (p === 'symmetric') return [norm(role.label)];
  if (p === 'oneSided') return [];
  if (!Array.isArray(p)) return [];

  const cand = p.map(norm);
  if (cand.length <= 1) return cand;

  const used = new Set(otherPersonRoles.map(norm));
  const hit = cand.filter((c) => used.has(c));
  return hit.length ? [...hit, ...cand.filter((c) => !hit.includes(c))] : cand;
}

/** 층위1 은 항상 열려 있고, 2·3 은 계열이 접힌 채로 시작한다(§5). */
export function groupByCategory(vocab, { includeHidden = false } = {}) {
  const out = [];
  for (const c of vocab.doc.categories) {
    const items = vocab.doc.roles.filter((r) => r.category === c.id && (includeHidden || !r.hidden));
    if (items.length) out.push({ category: c, items });
  }
  const orphan = vocab.doc.roles.filter(
    (r) => !vocab.doc.categories.some((c) => c.id === r.category) && (includeHidden || !r.hidden),
  );
  if (orphan.length) out.push({ category: FALLBACK_CATEGORY, items: orphan });
  return out;
}

/**
 * 임시 어휘 중 **고른 것만** `roles.json` 에 붙여넣을 형태로 만든다(§5).
 * 전부 담아주면 생각 없이 붙여넣게 되고, 그러면 「고유명은 커밋 안 한다」 규칙이
 * 없는 것과 같아진다.
 */
export function clipboardForRepo(roles) {
  const clean = roles.map((r) => {
    const { temp, ...rest } = r;
    return rest;
  });
  return clean.map((r) => '  ' + JSON.stringify(r)).join(',\n');
}
