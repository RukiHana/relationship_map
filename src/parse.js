// parse.js — 텍스트 줄 → 관계 + 진단
//
// ★ 이 파일은 아무것도 import 하지 않는다. (CLAUDE.md 「파일이 뭘 맡나」)
//   다른 모듈의 import 경로에는 캐시용 ?v= 가 붙는데, node ESM 이 그걸 해석하지
//   못해서 tests/parse.test.js 가 통째로 못 돈다. 그래서 아는 이름 목록과 어휘
//   인덱스를 인자로 받는 순수 모듈로 둔다.
//
// 절대 원칙 (계획서 §6): **파싱은 파괴적이지 않다.**
//   못 알아본 줄은 적힌 그대로 남기고 옆에 표시만 한다.
//   여기서 raw 를 고쳐 쓰는 코드는 하나도 없어야 한다.

// ─────────────────────────────────────────── 정규화

/** 한글 정규화. 입력 경계마다 건다 — 아이패드↔컴퓨터 왕복이 주 경로다(§4). */
export function nfc(s) {
  return typeof s === 'string' ? s.normalize('NFC') : s;
}

export function norm(s) {
  return nfc(String(s ?? '')).trim();
}

// 하이픈 자리에 올 수 있는 것들. **가타카나 장음 부호(ー)는 넣지 않는다** —
// 일본어 이름에 그대로 쓰이는 글자라 바꾸면 이름이 망가진다.
const DASHES = /[‐‑‒–—―−－]/g;
const QUOTES = /[“”″＂]/g;

/**
 * 판정용 정규화. **원본 줄은 절대 이걸로 갈아치우지 않는다.**
 * NFC · 전각 콜론 · 각종 대시 · 굽은 따옴표 · 연속 공백.
 */
export function normalizeLine(raw) {
  return nfc(String(raw ?? ''))
    .replace(/：/g, ':')
    .replace(DASHES, '-')
    .replace(QUOTES, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────── 어휘 인덱스

/**
 * roles.json 형태의 문서 → 조회용 인덱스.
 * label 과 aliases 를 같은 맵에 넣는다 — 텍스트에 쓰이는 게 이름이기 때문(§5).
 */
export function buildRoleIndex(rolesDoc) {
  const roles = new Map();
  const categories = new Map();
  const modifiers = new Set();

  for (const c of rolesDoc?.categories ?? []) categories.set(c.id, c);
  for (const m of rolesDoc?.modifiers ?? []) modifiers.add(norm(m));

  for (const r of rolesDoc?.roles ?? []) {
    const label = norm(r.label);
    if (!label) continue;
    if (!roles.has(label)) roles.set(label, r);
    for (const a of r.aliases ?? []) {
      const key = norm(a);
      if (key && !roles.has(key)) roles.set(key, r);
    }
  }
  return { roles, categories, modifiers };
}

/** 파싱에 필요한 것만 담은 문맥. 테스트도 이걸로 만든다. */
export function makeContext({ names = [], rolesDoc = null, roleIndex = null } = {}) {
  const idx = roleIndex ?? buildRoleIndex(rolesDoc ?? {});
  return {
    names: new Set([...names].map(norm)),
    roles: idx.roles,
    categories: idx.categories,
    modifiers: idx.modifiers,
  };
}

// ─────────────────────────────────────────── 따옴표 인식 분할

/** 따옴표 **밖**에 있는 ch 의 위치를 전부 준다. 안쪽은 구분자로 안 본다(§6-4). */
function topLevelPositions(s, ch) {
  const out = [];
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && c === ch) out.push(i);
  }
  return out;
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).trim();
  return t;
}

// ─────────────────────────────────────────── 역할 해석

const MOD_TAIL = /^([\s\S]*?)\s*\(([^()]*)\)\s*$/;

/**
 * 역할 한 칸을 푼다. **괄호를 먼저 뗀다**(§6-3).
 * 괄호 안은 수식 폐쇄목록 6개만 들어갈 수 있고, 그 밖의 말이 오면
 * 줄을 살려둔 채 표시만 한다.
 */
export function resolveRole(text, ctx) {
  const raw = String(text ?? '').trim();
  if (raw === '') {
    // **빈 쪽은 유효한 값이다.** 한쪽 관계가 여기서 갈린다(§6-3).
    return { text: '', base: '', mods: [], badMods: [], role: null, label: null, empty: true, known: true };
  }

  let base = raw;
  const mods = [];
  const badMods = [];

  const m = MOD_TAIL.exec(raw);
  if (m) {
    base = m[1].trim();
    for (const piece of m[2].split(',')) {
      const w = norm(piece);
      if (w === '') continue;
      (ctx.modifiers.has(w) ? mods : badMods).push(w);
    }
  }

  const key = norm(unquote(base));
  const role = ctx.roles.get(key) ?? null;
  return {
    text: raw,
    base: key,
    mods,
    badMods,
    role,
    label: role ? norm(role.label) : null,
    empty: false,
    known: !!role,
  };
}

// ─────────────────────────────────────────── 한 줄 파싱

function classify(raw) {
  const t = normalizeLine(raw);
  if (t === '') return 'blank';
  if (t.startsWith('#')) return 'comment';
  return 'relation';
}

/**
 * 이름 쌍 · 역할 쌍을 **같은 함수**로 처리한다(§6-3).
 * 가능한 모든 `-` 위치에서 잘라보고 양쪽 다 통과하는 것만 남긴다.
 *
 * accept(part, side) → true 면 그 자리 후보로 인정.
 */
function splitPair(s, accept) {
  const cuts = topLevelPositions(s, '-');
  const hits = [];
  for (const i of cuts) {
    const l = s.slice(0, i);
    const r = s.slice(i + 1);
    if (accept(l, 'left') && accept(r, 'right')) hits.push([l, r, i]);
  }
  return { cuts, hits };
}

/** 진단 한 건. level 은 화면의 줄 클래스가 된다(.err / .warn). */
function diag(level, code, message) {
  return { level, code, message };
}

/**
 * 관계 줄 하나를 푼다.
 * ctx.names 는 **읽기만** 한다 — 자동 생성은 parseDocument 가 모아 처리한다.
 */
export function parseRelationLine(raw, ctx, lineIndex = 0) {
  const entry = {
    kind: 'relation',
    lineIndex,
    raw,                       // ★ 원본 그대로. 절대 안 고친다
    text: normalizeLine(raw),
    nameA: null, nameB: null,
    roleA: null, roleB: null,
    category: null,
    oneSided: null,            // 'A' | 'B' | null — 화살표가 붙는 쪽
    newNames: [],
    diagnostics: [],
    ok: false,
  };
  const s = entry.text;

  // 2. 따옴표 밖 첫 `:` 로 나눈다
  const colons = topLevelPositions(s, ':');
  if (colons.length === 0) {
    entry.kind = 'unparsed';
    entry.diagnostics.push(diag('err', 'no-colon', '`:` 가 없습니다. 형식은 `A-B : 역할A - 역할B` 입니다'));
    return entry;
  }
  const namesPart = s.slice(0, colons[0]).trim();
  const rolesPart = s.slice(colons[0] + 1).trim();

  // 3-a. 이름 쪽 — 아는 이름으로 가른다
  const known = (p) => {
    const v = norm(unquote(p));
    return v !== '' && ctx.names.has(v);
  };
  const nameSplit = splitPair(namesPart, known);

  let nameA = null, nameB = null;
  if (nameSplit.hits.length === 1) {
    nameA = norm(unquote(nameSplit.hits[0][0]));
    nameB = norm(unquote(nameSplit.hits[0][1]));
  } else if (nameSplit.hits.length > 1) {
    // 자르는 위치가 여럿이다. 같은 이름이 둘일 일은 없으므로(§4) 이 경우뿐이다.
    const [l, r] = nameSplit.hits[0];
    nameA = norm(unquote(l));
    nameB = norm(unquote(r));
    const opts = nameSplit.hits.map(([a, b]) => `${norm(unquote(a))} / ${norm(unquote(b))}`).join('  ·  ');
    entry.diagnostics.push(diag('warn', 'ambiguous-names',
      `이름을 가르는 방법이 ${nameSplit.hits.length}가지입니다 — ${opts}. 앞엣것으로 읽었습니다. 이름을 따옴표로 감싸면 확정됩니다`));
  } else if (nameSplit.cuts.length === 1) {
    // 아무것도 안 맞고 `-` 가 하나뿐 → 새 캐릭터로 본다. 인물을 쭉 적어 내려갈 때의 정상 경로다
    const i = nameSplit.cuts[0];
    nameA = norm(unquote(namesPart.slice(0, i)));
    nameB = norm(unquote(namesPart.slice(i + 1)));
  } else if (nameSplit.cuts.length === 0) {
    entry.kind = 'unparsed';
    entry.diagnostics.push(diag('err', 'no-name-separator', '이름 쪽에 `-` 가 없습니다'));
    return entry;
  } else {
    entry.kind = 'unparsed';
    entry.diagnostics.push(diag('err', 'unknown-names',
      `이름을 가를 수 없습니다. \`${namesPart}\` 에서 아는 이름 쌍을 못 찾았고 \`-\` 가 ${nameSplit.cuts.length}개라 어디서 자를지 정할 수 없습니다. 이름을 따옴표로 감싸주세요`));
    return entry;
  }

  // **이름 쪽 빈 값은 오류다.** (역할 쪽과 다르다 — §6-3)
  if (nameA === '' || nameB === '') {
    entry.kind = 'unparsed';
    entry.diagnostics.push(diag('err', 'empty-name', '이름이 비었습니다'));
    return entry;
  }
  entry.nameA = nameA;
  entry.nameB = nameB;
  for (const n of [nameA, nameB]) if (!ctx.names.has(n)) entry.newNames.push(n);

  // 3-b. 역할 쪽 — 같은 함수, 다만 **빈 문자열을 통과시킨다**
  const roleOk = (p) => {
    const t = p.trim();
    if (t === '') return true;
    const r = resolveRole(t, ctx);
    return r.known;
  };
  const roleSplit = splitPair(rolesPart, roleOk);

  let rawA = '', rawB = '';
  if (roleSplit.hits.length >= 1) {
    if (roleSplit.hits.length > 1) {
      entry.diagnostics.push(diag('warn', 'ambiguous-roles',
        `역할을 가르는 방법이 ${roleSplit.hits.length}가지입니다. 앞엣것으로 읽었습니다`));
    }
    rawA = roleSplit.hits[0][0];
    rawB = roleSplit.hits[0][1];
  } else if (roleSplit.cuts.length === 1) {
    rawA = rolesPart.slice(0, roleSplit.cuts[0]);
    rawB = rolesPart.slice(roleSplit.cuts[0] + 1);
  } else if (roleSplit.cuts.length === 0) {
    // `지나-선 : 짝사랑` — 뒤 대시를 안 쓴 경우. 지우지 않고 한쪽 관계로 읽는다
    rawA = rolesPart;
    rawB = '';
    if (rolesPart !== '') {
      entry.diagnostics.push(diag('warn', 'no-role-separator',
        '역할 쪽에 `-` 가 없습니다. 한쪽 관계로 읽었습니다'));
    }
  } else {
    // `-` 가 여럿인데 아는 역할 쌍이 없다 → 첫 자리에서 자르고 모르는 역할로 둔다
    rawA = rolesPart.slice(0, roleSplit.cuts[0]);
    rawB = rolesPart.slice(roleSplit.cuts[0] + 1);
    entry.diagnostics.push(diag('warn', 'ambiguous-roles',
      `역할을 가를 수 없어 첫 \`-\` 에서 잘랐습니다`));
  }

  const roleA = resolveRole(rawA, ctx);
  const roleB = resolveRole(rawB, ctx);
  entry.roleA = roleA;
  entry.roleB = roleB;

  // 모르는 역할 — 막지 않는다. 회색 선으로 그리고 「목록에 추가」 버튼을 띄운다(§5)
  for (const [r, which] of [[roleA, 'A'], [roleB, 'B']]) {
    if (!r.empty && !r.known) {
      entry.diagnostics.push(diag('err', 'unknown-role',
        `'${r.base}' 는 목록에 없는 관계명입니다 (역할${which})`));
    }
    for (const bad of r.badMods) {
      entry.diagnostics.push(diag('err', 'unknown-modifier',
        `'${bad}' 는 수식이 아닙니다. 수식은 과거·예정·의붓·양자·부계·모계 6개뿐입니다`));
    }
  }

  if (roleA.empty && roleB.empty) {
    entry.diagnostics.push(diag('warn', 'no-roles', '역할이 양쪽 다 비었습니다'));
  }
  entry.oneSided = roleA.empty && !roleB.empty ? 'A' : (!roleA.empty && roleB.empty ? 'B' : null);

  // 계열 — 채워진 쪽에서 가져온다. 둘 다 모르면 null(회색)
  const cat = (roleA.role ?? roleB.role)?.category ?? null;
  entry.category = cat;

  // 자기 자신과의 관계 — 그릴 방법이 없으므로 선은 안 그리고 표시만 남긴다(§6)
  if (nameA === nameB) {
    entry.diagnostics.push(diag('warn', 'self', '자기 자신과의 관계입니다. 관계도에는 안 그려집니다'));
  }

  // 짝이 안 맞는 관계 — 「순환 금지」가 이 검사의 부분집합이다
  const mismatch = pairMismatch(roleA, roleB);
  if (mismatch) entry.diagnostics.push(mismatch);

  entry.ok = true;
  return entry;
}

/**
 * 비대칭 역할인데 반대쪽이 자기 `pair` 목록에 없으면 표시한다.
 * `A-B : 엄마 - 엄마`(순환) 가 여기서 걸리고, `엄마 - 선배` 같은 어긋난 짝도 같이 잡힌다.
 * **표시만 하고 막지 않는다**(§4).
 */
function pairMismatch(roleA, roleB) {
  if (roleA.empty || roleB.empty || !roleA.known || !roleB.known) return null;
  const check = (self, other) => {
    const p = self.role.pair;
    if (!Array.isArray(p)) return false;          // symmetric / oneSided 는 검사 안 함
    return !p.map(norm).includes(other.label);
  };
  const badA = check(roleA, roleB);
  const badB = check(roleB, roleA);
  if (!badA && !badB) return null;
  const expect = Array.isArray(roleA.role.pair) ? roleA.role.pair.join(' 또는 ') : null;
  return diag('warn', 'pair-mismatch',
    expect
      ? `'${roleA.label}' 의 짝은 ${expect} 입니다. '${roleB.label}' 로 적혀 있습니다`
      : `'${roleA.label}' 와 '${roleB.label}' 는 서로의 짝이 아닙니다`);
}

// ─────────────────────────────────────────── 문서 전체

/**
 * 줄 배열 전체를 판다. **빈 줄과 주석은 그대로 보존한다.**
 *
 * @param {string[]} lines
 * @param {object}   ctx   makeContext() 결과
 * @returns {{entries, relations, newNames, byLine}}
 */
export function parseDocument(lines, ctx) {
  // 자동 생성된 이름이 뒤 줄에서 아는 이름이 되도록 작업용 사본을 굴린다(§6-3)
  const working = { ...ctx, names: new Set(ctx.names) };

  const entries = [];
  const newNames = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const kind = classify(raw);

    if (kind !== 'relation') {
      entries.push({ kind, lineIndex: i, raw, text: normalizeLine(raw), diagnostics: [] });
      continue;
    }

    const e = parseRelationLine(raw, working, i);
    for (const n of e.newNames) {
      if (!working.names.has(n)) { working.names.add(n); newNames.push(n); }
    }
    entries.push(e);
  }

  // **완전히 같은 줄이 두 번** — 관계는 목록이라 중복 자체는 정상이지만(§4),
  // 글자까지 똑같은 줄은 복사 실수일 확률이 높으니 두 줄 모두에 표시를 남긴다.
  const seen = new Map();
  for (const e of entries) {
    if (e.kind !== 'relation') continue;
    const key = e.text;
    if (seen.has(key)) {
      const first = seen.get(key);
      const msg = '글자까지 똑같은 줄이 있습니다. 관계도에서는 선 두 개가 겹쳐 한 개처럼 보입니다';
      if (!first.diagnostics.some((d) => d.code === 'duplicate')) {
        first.diagnostics.push(diag('warn', 'duplicate', msg));
      }
      e.diagnostics.push(diag('warn', 'duplicate', msg));
    } else {
      seen.set(key, e);
    }
  }

  const byLine = new Map();
  for (const e of entries) if (e.diagnostics.length) byLine.set(e.lineIndex, e.diagnostics);

  return {
    entries,
    relations: entries.filter((e) => e.kind === 'relation' && e.ok),
    newNames,
    byLine,
  };
}
