// cases.js — 파서 케이스 원본. node 러너와 브라우저 러너가 **같은 이 파일**을 읽는다.
//
// 목록의 근거는 계획서 §11. 순서는 §6이 정한 대로 **한쪽 관계가 첫 케이스**다 —
// 빈 쪽 처리가 빠지면 여기서 바로 걸린다.
//
// 어휘는 여기 안에 최소한으로 박아둔다. src/roles.json 을 읽지 않는 이유:
// 어휘가 늘거나 줄 때마다 파서 테스트가 깨지면 안 되기 때문이다.
// roles.json 자체의 무결성은 별도로 본다(중복·미참조 검사).

import {
  makeContext, parseDocument, parseRelationLine, resolveRole, normalizeLine, nfc,
} from '../src/parse.js';
import {
  serializeRelation, serializeRole, quoteName, needsQuote,
  replaceLine, removeLines, findLinesWithName, renameInLines,
  packBundle, unpackBundle, nextIdFrom, bundleFileName,
} from '../src/serialize.js';

const ROLES_DOC = {
  categories: [
    { id: 'direct', label: '직계 가족', tier: 1, color: '#c2683f', style: 'solid' },
    { id: 'peer', label: '또래', tier: 1, color: '#4f8a6b', style: 'solid' },
    { id: 'work', label: '직장·조직', tier: 1, color: '#4a6fb0', style: 'solid' },
    { id: 'romance', label: '연애·감정', tier: 1, color: '#c8467a', style: 'solid' },
    { id: 'hostile', label: '적대·갈등', tier: 1, color: '#8b3a3a', style: 'dashed' },
  ],
  modifiers: ['과거', '예정', '의붓', '양자', '부계', '모계'],
  roles: [
    { id: 'r_mother', label: '엄마', category: 'direct', tier: 1, pair: ['아들', '딸'] },
    { id: 'r_daughter', label: '딸', category: 'direct', tier: 1, pair: ['엄마', '아빠'] },
    { id: 'r_father', label: '아빠', category: 'direct', tier: 1, pair: ['아들', '딸'] },
    { id: 'r_grandma', label: '할머니', category: 'direct', tier: 1, pair: ['손자', '손녀'] },
    { id: 'r_grandson', label: '손자', category: 'direct', tier: 1, pair: ['할머니'] },
    { id: 'r_obro', label: '형', category: 'direct', tier: 1, pair: ['남동생'], aliases: ['오빠'] },
    { id: 'r_ybro', label: '남동생', category: 'direct', tier: 1, pair: ['형'] },
    { id: 'r_wife', label: '아내', category: 'direct', tier: 1, pair: ['남편'] },
    { id: 'r_husband', label: '남편', category: 'direct', tier: 1, pair: ['아내'] },
    { id: 'r_friend', label: '친구', category: 'peer', tier: 1, pair: 'symmetric' },
    { id: 'r_severed', label: '절교한 친구', category: 'peer', tier: 1, pair: 'symmetric' },
    { id: 'r_senior', label: '선배', category: 'peer', tier: 1, pair: ['후배'] },
    { id: 'r_boss', label: '상사', category: 'work', tier: 1, pair: ['부하'], aliases: ['상관'] },
    { id: 'r_subord', label: '부하', category: 'work', tier: 1, pair: ['상사'], aliases: ['직속'] },
    { id: 'r_crush', label: '짝사랑', category: 'romance', tier: 1, pair: 'oneSided' },
    { id: 'r_rival', label: '라이벌', category: 'hostile', tier: 1, pair: 'symmetric' },
  ],
};

const NAMES = ['지나', '당옥', '선', '달래', '장-보고', '가:나', '김(가짜)철수'];

function ctxOf(names = NAMES) {
  return makeContext({ names, rolesDoc: ROLES_DOC });
}

/** 관계의 **내용** 지문. 왕복 비교는 이걸로 한다(형식 경고는 왕복하면서 사라지는 게 정상이다). */
function signature(parsed) {
  return parsed.entries.map((e) => {
    if (e.kind !== 'relation') return `${e.kind}|${e.raw}`;
    if (!e.ok) return `unparsed|${e.text}`;
    const r = (x) => `${x.base}${x.mods.length ? `(${x.mods.join(',')})` : ''}${x.badMods.length ? `!${x.badMods.join(',')}` : ''}`;
    return `rel|${e.nameA}|${e.nameB}|${r(e.roleA)}|${r(e.roleB)}|${e.oneSided ?? '-'}`;
  }).join('\n');
}

/** parse → serialize → parse. 관계 줄만 다시 쓰고 나머지 줄은 원본 그대로 둔다. */
function roundtrip(lines, ctx) {
  const p1 = parseDocument(lines, ctx);
  const rewritten = p1.entries.map((e) => (e.kind === 'relation' && e.ok ? serializeRelation(e) : e.raw));
  const p2 = parseDocument(rewritten, ctx);
  return { p1, p2, rewritten };
}

function codes(entry) {
  return entry.diagnostics.map((d) => d.code).sort();
}

// ─────────────────────────────────────────────────────────────

export const tests = [

  // ① 한쪽 관계 — §6이 「그 테스트의 첫 케이스로 넣는다」고 지정한 것
  ['한쪽 관계 — 오른쪽이 빈다', (t) => {
    const p = parseDocument(['지나-선 : 짝사랑 -'], ctxOf());
    t.eq(p.relations.length, 1, '관계 1건이 나와야 한다');
    const r = p.relations[0];
    t.eq(r.nameA, '지나'); t.eq(r.nameB, '선');
    t.eq(r.roleA.base, '짝사랑');
    t.ok(r.roleB.empty, '오른쪽 역할은 비어 있어야 한다');
    t.eq(r.oneSided, 'B', '화살표는 상대(B) 쪽에 붙는다');
    t.eq(r.category, 'romance');
    t.deep(codes(r), [], '빈 쪽은 유효한 값이므로 진단이 없어야 한다');
  }],

  ['한쪽 관계 — 왼쪽이 빈다', (t) => {
    const p = parseDocument(['지나-선 : - 짝사랑'], ctxOf());
    t.eq(p.relations.length, 1);
    const r = p.relations[0];
    t.ok(r.roleA.empty, '왼쪽 역할이 비어 있어야 한다');
    t.eq(r.roleB.base, '짝사랑');
    t.eq(r.oneSided, 'A');
    t.deep(codes(r), []);
  }],

  ['한쪽 관계 — 왕복해도 그대로', (t) => {
    const lines = ['지나-선 : 짝사랑 -', '지나-선 : - 짝사랑'];
    const { p1, p2, rewritten } = roundtrip(lines, ctxOf());
    t.eq(signature(p2), signature(p1), '왕복 동일성');
    t.eq(rewritten[0], '지나-선 : 짝사랑 -', '빈 쪽이 살아 있어야 한다');
    t.eq(rewritten[1], '지나-선 : - 짝사랑', '왼쪽이 빈 것도 그대로');
  }],

  // ② 이름에 `-` 가 든 경우 — 규칙만으로는 못 가르고 아는 이름 목록으로 가른다(§6)
  ['하이픈 든 이름 — 아는 이름으로 가른다', (t) => {
    const p = parseDocument(['장-보고-당옥 : 부하 - 상관'], ctxOf());
    t.eq(p.relations.length, 1);
    const r = p.relations[0];
    t.eq(r.nameA, '장-보고', '`장`/`보고-당옥` 이 아니라 `장-보고`/`당옥` 으로 갈려야 한다');
    t.eq(r.nameB, '당옥');
    t.eq(r.roleA.base, '부하');
    t.eq(r.roleB.base, '상관');
    t.eq(r.roleB.label, '상사', '별칭 `상관` 은 `상사` 항목으로 해석된다');
    t.deep(codes(r), [], '별칭은 정상 입력이다');
  }],

  ['하이픈 든 이름 — 되쓸 때 따옴표로 감싼다', (t) => {
    const { p1, p2, rewritten } = roundtrip(['장-보고-당옥 : 부하 - 상관'], ctxOf());
    t.eq(rewritten[0], '"장-보고"-당옥 : 부하 - 상관');
    t.eq(signature(p2), signature(p1), '왕복 동일성');
  }],

  ['하이픈 든 이름 — 감싼 뒤에는 이름 목록 없이도 갈린다', (t) => {
    // 아는 이름을 하나도 안 주고 파싱해도 따옴표가 자리를 확정한다
    const p = parseDocument(['"장-보고"-당옥 : 부하 - 상관'], ctxOf([]));
    t.eq(p.relations.length, 1);
    t.eq(p.relations[0].nameA, '장-보고');
    t.eq(p.relations[0].nameB, '당옥');
  }],

  // ③ 이름에 `:` 가 든 경우 — 안 감싸면 첫 콜론 분할이 엉뚱한 자리에서 잘린다(§6-4)
  ['콜론 든 이름 — 따옴표 안의 `:` 는 구분자가 아니다', (t) => {
    const p = parseDocument(['"가:나"-당옥 : 친구 - 친구'], ctxOf());
    t.eq(p.relations.length, 1);
    t.eq(p.relations[0].nameA, '가:나');
    t.eq(p.relations[0].nameB, '당옥');
    t.eq(p.relations[0].roleA.base, '친구');
  }],

  ['콜론 든 이름 — 되쓸 때 감싼다', (t) => {
    const { rewritten, p1, p2 } = roundtrip(['"가:나"-당옥 : 친구 - 친구'], ctxOf());
    t.eq(rewritten[0], '"가:나"-당옥 : 친구 - 친구');
    t.eq(signature(p2), signature(p1));
  }],

  // ④ 괄호가 든 이름 — 역할 쪽 수식으로 오독되면 안 된다(§11)
  ['괄호 든 이름 — 수식으로 오독하지 않는다', (t) => {
    const p = parseDocument(['김(가짜)철수-당옥 : 친구 - 친구'], ctxOf());
    t.eq(p.relations.length, 1);
    const r = p.relations[0];
    t.eq(r.nameA, '김(가짜)철수', '이름 쪽에는 괄호 처리를 하지 않는다');
    t.deep(r.roleA.mods, [], '역할에는 수식이 없어야 한다');
    t.deep(r.roleA.badMods, []);
  }],

  ['괄호 든 이름 — 되쓸 때 감싼다', (t) => {
    const { rewritten, p1, p2 } = roundtrip(['김(가짜)철수-당옥 : 친구 - 친구'], ctxOf());
    t.eq(rewritten[0], '"김(가짜)철수"-당옥 : 친구 - 친구');
    t.eq(signature(p2), signature(p1));
  }],

  // ⑤ 수식 — 폐쇄목록 6개. 쉼표로 여러 개(§6-3)
  ['수식 — 하나', (t) => {
    const r = parseRelationLine('지나-달래 : 딸 - 엄마(의붓)', ctxOf(), 0);
    t.eq(r.roleB.base, '엄마');
    t.deep(r.roleB.mods, ['의붓']);
    t.deep(codes(r), [], '정상 입력이다');
  }],

  ['수식 — 쉼표로 여러 개', (t) => {
    const r = parseRelationLine('지나-당옥 : 손자 - 할머니(부계, 과거)', ctxOf(), 0);
    t.eq(r.roleB.base, '할머니');
    t.deep(r.roleB.mods, ['부계', '과거']);
  }],

  ['수식 — 폐쇄목록 밖이면 줄은 살고 표시만 남는다', (t) => {
    const p = parseDocument(['지나-당옥 : 딸 - 엄마(친)'], ctxOf());
    t.eq(p.entries.length, 1);
    const r = p.entries[0];
    t.ok(r.ok, '줄이 죽으면 안 된다');
    t.eq(r.raw, '지나-당옥 : 딸 - 엄마(친)', '원본이 그대로 남아야 한다');
    t.eq(r.roleB.base, '엄마', '관계명은 정상으로 읽힌다');
    t.deep(r.roleB.badMods, ['친']);
    t.ok(codes(r).includes('unknown-modifier'), '표시는 남아야 한다');
  }],

  ['수식 — 왕복해도 그대로', (t) => {
    const lines = [
      '지나-달래 : 딸 - 엄마(의붓)',
      '지나-당옥 : 손자 - 할머니(부계, 과거)',
      '지나-선 : 아내(과거) -',
      '지나-당옥 : 딸 - 엄마(친)',
    ];
    const { p1, p2, rewritten } = roundtrip(lines, ctxOf());
    t.eq(signature(p2), signature(p1), '왕복 동일성');
    t.eq(rewritten[0], '지나-달래 : 딸 - 엄마(의붓)');
    t.eq(rewritten[2], '지나-선 : 아내(과거) -');
    t.eq(rewritten[3], '지나-당옥 : 딸 - 엄마(친)', '모르는 수식도 사용자가 쓴 그대로 남는다');
  }],

  // ⑥ 자기 자신과의 관계 — 막지 않고 표시만(§6)
  ['자기 자신과의 관계 — 살려두고 표시만', (t) => {
    const p = parseDocument(['지나-지나 : 친구 - 친구'], ctxOf());
    const r = p.entries[0];
    t.ok(r.ok, '줄이 죽으면 안 된다');
    t.eq(r.nameA, r.nameB);
    t.ok(codes(r).includes('self'));
  }],

  // ⑦ 완전히 같은 줄이 두 번 — 두 줄 모두에 표시(§6)
  ['똑같은 줄 두 번 — 두 줄 다 표시된다', (t) => {
    const p = parseDocument([
      '지나-당옥 : 딸 - 엄마',
      '지나-선 : 짝사랑 -',
      '지나-당옥 : 딸 - 엄마',
    ], ctxOf());
    t.ok(codes(p.entries[0]).includes('duplicate'), '첫째 줄에도 표시가 있어야 한다');
    t.ok(codes(p.entries[2]).includes('duplicate'), '셋째 줄에도 표시가 있어야 한다');
    t.deep(codes(p.entries[1]), [], '가운데 줄은 멀쩡해야 한다');
  }],

  ['같은 두 사람 사이 관계 여러 개는 정상이다', (t) => {
    const p = parseDocument([
      '지나-선 : 남동생 - 형',
      '지나-선 : 라이벌 - 라이벌',
    ], ctxOf());
    t.eq(p.relations.length, 2, '남매이면서 라이벌은 정상이다');
    t.deep(codes(p.entries[0]), []);
    t.deep(codes(p.entries[1]), []);
  }],

  // ⑧ 주석·빈 줄 보존(§4)
  ['주석과 빈 줄을 그대로 보존한다', (t) => {
    const lines = [
      '지나-당옥 : 딸 - 엄마',
      '',
      '# 2부에서 뒤집힘',
      '   ',
      '#지나-선 : 짝사랑 -',
    ];
    const p = parseDocument(lines, ctxOf());
    t.eq(p.entries.map((e) => e.kind).join(','), 'relation,blank,comment,blank,comment');
    t.eq(p.relations.length, 1, '주석 처리된 관계 줄은 관계가 아니다');
    for (let i = 0; i < lines.length; i++) t.eq(p.entries[i].raw, lines[i], `${i}번 줄 원본 보존`);

    const { rewritten } = roundtrip(lines, ctxOf());
    t.deep(rewritten.slice(1), lines.slice(1), '관계가 아닌 줄은 손대지 않는다');
  }],

  // ⑨ 모르는 역할 — 회색으로 떨어지되 줄은 산다(§5)
  ['모르는 역할 — 줄은 살고 계열이 없다', (t) => {
    const p = parseDocument(['하늘-대호 : 남매 - 남매'], ctxOf(['하늘', '대호']));
    const r = p.entries[0];
    t.ok(r.ok);
    t.eq(r.roleA.base, '남매');
    t.eq(r.roleA.known, false);
    t.eq(r.category, null, '계열을 못 정하면 회색이다');
    t.ok(codes(r).includes('unknown-role'));
    t.eq(r.raw, '하늘-대호 : 남매 - 남매', '원본 보존');
  }],

  ['모르는 역할도 왕복한다', (t) => {
    const { p1, p2 } = roundtrip(['하늘-대호 : 남매 - 남매'], ctxOf(['하늘', '대호']));
    t.eq(signature(p2), signature(p1));
  }],

  // ⑩ 짝 어긋남 — 「순환 금지」가 이 검사의 부분집합이다(§4)
  ['순환 — A가 B의 엄마이고 B가 A의 엄마', (t) => {
    const p = parseDocument(['지나-당옥 : 엄마 - 엄마'], ctxOf());
    const r = p.entries[0];
    t.ok(r.ok, '막지 않는다');
    t.ok(codes(r).includes('pair-mismatch'), '표시는 한다');
  }],

  ['정상 짝은 조용하다', (t) => {
    const p = parseDocument([
      '지나-당옥 : 딸 - 엄마',
      '지나-선 : 친구 - 친구',
      '정우-강림 : 부하 - 상관',
      '지나-선 : 라이벌 - 라이벌',
    ], ctxOf([...NAMES, '정우', '강림']));
    for (const e of p.entries) t.deep(codes(e), [], `조용해야 한다: ${e.raw}`);
  }],

  ['대칭·일방 역할은 짝 검사를 안 한다', (t) => {
    const p = parseDocument([
      '지나-선 : 짝사랑 - 친구',
      '지나-선 : 친구 - 라이벌',
    ], ctxOf());
    for (const e of p.entries) t.ok(!codes(e).includes('pair-mismatch'), e.raw);
  }],

  // ⑪ 자동 생성 — 인물을 쭉 적어 내려갈 때의 정상 경로(§6-3)
  ['모르는 이름 둘 — 자동 생성', (t) => {
    const p = parseDocument(['신입-신참 : 친구 - 친구'], ctxOf());
    t.eq(p.relations.length, 1);
    t.deep(p.newNames, ['신입', '신참']);
    t.deep(codes(p.entries[0]), [], '자동 생성은 오류가 아니다');
  }],

  ['자동 생성된 이름은 뒤 줄에서 아는 이름이 된다', (t) => {
    // 첫 줄에서 따옴표로 `장-보고` 를 확정해 만들고,
    // 둘째 줄은 따옴표 없이 써도 **아는 이름 목록** 덕분에 갈려야 한다.
    const p = parseDocument([
      '"장-보고"-당옥 : 부하 - 상관',
      '장-보고-선 : 친구 - 친구',
    ], ctxOf(['당옥', '선']));
    t.deep(p.newNames, ['장-보고'], '첫 줄에서 한 명만 생겨야 한다');
    t.eq(p.relations.length, 2);
    t.eq(p.relations[1].nameA, '장-보고', '둘째 줄이 앞 줄에서 생긴 이름으로 갈려야 한다');
    t.eq(p.relations[1].nameB, '선');
  }],

  ['`-` 가 여럿인데 아는 쌍이 없으면 못 가른다고 말한다', (t) => {
    const p = parseDocument(['가-나-다 : 친구 - 친구'], ctxOf([]));
    t.eq(p.entries[0].kind, 'unparsed');
    t.ok(codes(p.entries[0]).includes('unknown-names'));
    t.eq(p.entries[0].raw, '가-나-다 : 친구 - 친구', '오류여도 원본은 남는다');
  }],

  ['이름을 가르는 방법이 여럿이면 표시한다', (t) => {
    // `가-나-다` 를 `가`/`나-다` 로도, `가-나`/`다` 로도 가를 수 있는 상황
    const p = parseDocument(['가-나-다 : 친구 - 친구'], ctxOf(['가', '나-다', '가-나', '다']));
    t.ok(p.entries[0].ok, '막지 않는다');
    t.ok(codes(p.entries[0]).includes('ambiguous-names'), '표시는 한다');
  }],

  ['이름이 비면 오류다 (역할 쪽과 다르다)', (t) => {
    const p = parseDocument(['-당옥 : 친구 - 친구'], ctxOf());
    t.eq(p.entries[0].kind, 'unparsed');
    t.ok(codes(p.entries[0]).includes('empty-name'));
    t.eq(p.entries[0].raw, '-당옥 : 친구 - 친구', '오류여도 원본은 남는다');
  }],

  ['콜론이 없으면 오류지만 줄은 남는다', (t) => {
    const p = parseDocument(['지나-당옥 딸 엄마'], ctxOf());
    t.eq(p.entries[0].kind, 'unparsed');
    t.ok(codes(p.entries[0]).includes('no-colon'));
    t.eq(p.entries[0].raw, '지나-당옥 딸 엄마');
  }],

  // ⑫ 정규화 — 아이패드↔컴퓨터 왕복이 주 경로다(§4)
  ['전각 콜론·각종 대시·연속 공백을 받아준다', (t) => {
    const p = parseDocument(['지나—당옥　：　딸  －  엄마'], ctxOf());
    t.eq(p.relations.length, 1, '전각 콜론과 em dash 가 섞여도 읽어야 한다');
    t.eq(p.relations[0].nameA, '지나');
    t.eq(p.relations[0].roleB.base, '엄마');
  }],

  ['NFC 정규화 — 눈에 같으면 같은 것으로 친다', (t) => {
    const decomposed = '지나'.normalize('NFD');
    t.ok(decomposed !== '지나', '전제: NFD 는 다른 문자열이다');
    const p = parseDocument([`${decomposed}-당옥 : 딸 - 엄마`], ctxOf());
    t.eq(p.relations.length, 1);
    t.eq(p.relations[0].nameA, '지나', 'NFC 로 맞춰져 아는 이름이 된다');
    t.deep(p.newNames, [], '새 캐릭터가 생기면 안 된다');
  }],

  // ⑬ 문서 전체 왕복(§6)
  ['문서 전체 왕복 동일성', (t) => {
    const lines = [
      '지나-당옥 : 딸 - 엄마',
      '지나-선 : 짝사랑 -',
      '지나-달래 : 딸 - 엄마(의붓)',
      '',
      '# 2부에서 뒤집힘',
      '장-보고-당옥 : 부하 - 상관',
      '"가:나"-당옥 : 친구 - 친구',
      '김(가짜)철수-선 : 친구 - 친구',
      '지나-지나 : 친구 - 친구',
      '하늘-대호 : 남매 - 남매',
      '지나-당옥 : 손자 - 할머니(부계, 과거)',
    ];
    const ctx = ctxOf([...NAMES, '하늘', '대호']);
    const { p1, p2 } = roundtrip(lines, ctx);
    t.eq(signature(p2), signature(p1), 'parse(serialize(parse(x))) === parse(x)');

    // 한 번 더 돌려도 안정적이어야 한다
    const rewritten2 = p2.entries.map((e) => (e.kind === 'relation' && e.ok ? serializeRelation(e) : e.raw));
    const p3 = parseDocument(rewritten2, ctx);
    t.eq(signature(p3), signature(p1), '두 번 왕복해도 같다');
  }],

  // ─── serialize 쪽

  ['따옴표 규칙', (t) => {
    t.eq(needsQuote('지나'), false);
    t.eq(needsQuote('장-보고'), true);
    t.eq(needsQuote('가:나'), true);
    t.eq(needsQuote('김(가짜)철수'), true);
    t.eq(quoteName('지나'), '지나');
    t.eq(quoteName('장-보고'), '"장-보고"');
  }],

  ['줄 단위 교체 — 그 줄만 바뀐다', (t) => {
    const lines = ['a', 'b', 'c'];
    const out = replaceLine(lines, 1, 'B');
    t.deep(out, ['a', 'B', 'c']);
    t.deep(lines, ['a', 'b', 'c'], '원본 배열은 안 건드린다');
  }],

  ['이름이 걸린 줄 찾기 — 주석은 안 센다(§4)', (t) => {
    const lines = [
      '지나-당옥 : 딸 - 엄마',
      '# 당옥은 2부에서 죽는다',
      '',
      '당옥-선 : 친구 - 친구',
      '지나-선 : 짝사랑 -',
    ];
    const p = parseDocument(lines, ctxOf());
    const idx = findLinesWithName(p.entries, '당옥');
    t.deep(idx, [0, 3], '주석 속 `당옥` 은 세면 안 된다');
  }],

  ['캐릭터 삭제 — 그 줄만 지우고 빈 줄·주석은 남는다(§4)', (t) => {
    const lines = [
      '지나-당옥 : 딸 - 엄마',
      '# 당옥 메모',
      '',
      '당옥-선 : 친구 - 친구',
      '지나-선 : 짝사랑 -',
    ];
    const p = parseDocument(lines, ctxOf());
    const out = removeLines(lines, findLinesWithName(p.entries, '당옥'));
    t.deep(out, ['# 당옥 메모', '', '지나-선 : 짝사랑 -']);
  }],

  ['이름 변경 — 걸린 줄만 갈아끼우고 주석은 안 건드린다(§4)', (t) => {
    const lines = [
      '지나-당옥 : 딸 - 엄마',
      '# 지나가 주인공이다',
      '지나-선 : 짝사랑 -',
      '당옥-선 : 친구 - 친구',
    ];
    const p = parseDocument(lines, ctxOf());
    const { lines: out, changed, preview } = renameInLines(lines, p.entries, '지나', '지현');
    t.deep(changed, [0, 2], '2개 줄이 바뀐다고 예고돼야 한다');
    t.eq(preview.length, 2);
    t.eq(out[0], '지현-당옥 : 딸 - 엄마');
    t.eq(out[1], '# 지나가 주인공이다', '주석 안의 이름은 그대로다');
    t.eq(out[2], '지현-선 : 짝사랑 -');
    t.eq(out[3], '당옥-선 : 친구 - 친구');
  }],

  ['이름 변경 — 새 이름에 하이픈이 있으면 감싼다', (t) => {
    const lines = ['지나-당옥 : 딸 - 엄마'];
    const p = parseDocument(lines, ctxOf());
    const { lines: out } = renameInLines(lines, p.entries, '지나', '지-나');
    t.eq(out[0], '"지-나"-당옥 : 딸 - 엄마');
    const p2 = parseDocument(out, ctxOf(['지-나', '당옥']));
    t.eq(p2.relations[0].nameA, '지-나');
  }],

  // ─── 번들

  ['번들 왕복', (t) => {
    const characters = [
      { id: 'P01', name: '지나', group: '본가', color: null, pos: [320, 180], fields: [['나이', '17']], notes: '' },
      { id: 'P03', name: '당옥', group: '본가', color: null, pos: [100, 260], fields: [], notes: '메모' },
    ];
    const lines = ['지나-당옥 : 딸 - 엄마', '', '# 주석'];
    const b = packBundle({ characters, lines, roles: ROLES_DOC, nextId: 9 });
    t.eq(b.format, 'charmap');
    t.eq(b.version, 1);
    t.deep(b.relationLines, lines, '관계 줄은 배열 그대로 — 빈 줄·주석까지 보존');

    const u = unpackBundle(JSON.parse(JSON.stringify(b)));
    t.ok(u.ok, u.error);
    t.eq(u.characters.length, 2);
    t.eq(u.characters[0].name, '지나');
    t.deep(u.characters[0].pos, [320, 180]);
    t.deep(u.lines, lines);
    t.eq(u.nextId, 9);
  }],

  ['nextId — 지운 번호를 재활용하지 않는다(§4 영구 결번)', (t) => {
    // P07 까지 썼다가 P07 을 지운 상태
    const characters = [{ id: 'P01', name: '가' }, { id: 'P03', name: '나' }];
    t.eq(nextIdFrom(characters), 4, '칸이 없으면 최댓값+1 로 물러선다');

    const b = packBundle({ characters, lines: [], nextId: 8 });
    t.eq(b.nextId, 8, '들고 있던 값이 담겨야 한다');
    t.eq(unpackBundle(JSON.parse(JSON.stringify(b))).nextId, 8, '다시 읽어도 8이어야 한다');

    const legacy = { format: 'charmap', version: 1, characters, relationLines: [] };
    t.eq(unpackBundle(legacy).nextId, 4, '옛 번들은 최댓값+1');
  }],

  ['번들이 아닌 것을 거절한다', (t) => {
    t.eq(unpackBundle(null).ok, false);
    t.eq(unpackBundle({ hello: 1 }).ok, false);
    t.eq(unpackBundle({ format: 'charmap', version: 99 }).ok, false, '새 형식은 거절');
  }],

  ['내보내기 파일명에 날짜와 시각이 박힌다(§8)', (t) => {
    t.eq(bundleFileName(new Date(2026, 6, 26, 18, 40)), 'charmap-20260726-1840.json');
  }],
];
