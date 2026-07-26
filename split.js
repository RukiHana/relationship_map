// split.js — 번들 하나 → 사람이 읽고 고치는 파일들
//
//   node split.js              data/ 안에서 가장 최근 번들을 집는다
//   node split.js <파일>        그 파일을 푼다
//   node split.js --clean      이번에 안 쓴 남은 파일을 지운다
//
// 브라우저는 폴더에 파일을 쓸 수 없다. 그래서 **앱은 덩어리 하나만 뱉고,
// 파일로 흩뿌리는 건 파일에 쓸 수 있는 쪽이 한다**(계획서 §8).
//
//   [앱] 데이터 내보내기 → charmap-20260726-1840.json
//                              ↓  node split.js
//        data/characters/지나.json · data/relations.md
//
// ★ 이 폴더를 아는 건 이 스크립트와 bundle.js 와 사람뿐이다. **앱은 안 읽는다.**

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackBundle } from './src/serialize.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const CHARS = join(DATA, 'characters');

const args = process.argv.slice(2);
const clean = args.includes('--clean');
const explicit = args.find((a) => !a.startsWith('--'));

// ─────────────────────────────────────────── 어느 번들을 집을 것인가

/**
 * **파일명의 날짜가 아니라 안에 든 `exportedAt` 을 본다**(§8).
 * 이름은 바뀔 수 있어도 내용은 안 바뀐다.
 */
function pickBundle() {
  if (explicit) {
    const p = resolve(ROOT, explicit);
    if (!existsSync(p)) die(`파일이 없습니다: ${explicit}`);
    return p;
  }
  if (!existsSync(DATA)) die(`data 폴더가 없습니다. 앱에서 「데이터 내보내기」한 파일을 거기 넣어주세요.`);

  const cands = readdirSync(DATA)
    .filter((f) => /^charmap.*\.json$/i.test(f))
    .map((f) => {
      const p = join(DATA, f);
      let at = 0;
      try { at = Date.parse(JSON.parse(readFileSync(p, 'utf-8')).exportedAt) || 0; } catch { /* 못 읽으면 0 */ }
      return { f, p, at };
    })
    .sort((a, b) => b.at - a.at);

  if (!cands.length) die('data 폴더에 charmap-*.json 이 없습니다.');
  return cands[0].p;
}

// ─────────────────────────────────────────── 파일명

const BAD = /[/\\:?*"<>|]/g;

/** 윈도우 금지문자를 `_` 로. 원래 이름은 파일 안 `name` 에 그대로 남는다(§8). */
function safeName(name) {
  return String(name).replace(BAD, '_').trim() || '이름없음';
}

function die(msg) {
  console.error(`\n!! ${msg}\n`);
  process.exit(1);
}

// ─────────────────────────────────────────── 본체

const src = pickBundle();

// **어느 파일을 집었는지 첫 줄에 찍는다.** 엉뚱한 걸 풀어놓고 모르는 게 제일 나쁘다(§8)
let raw;
try { raw = JSON.parse(readFileSync(src, 'utf-8')); } catch (e) { die(`JSON 을 못 읽었습니다: ${e.message}`); }
const u = unpackBundle(raw);
if (!u.ok) die(u.error);

console.log(`\n집은 파일: ${src.slice(ROOT.length + 1)}`);
console.log(`  exportedAt ${u.exportedAt ?? '(없음)'} · 인물 ${u.characters.length}명 · 줄 ${u.lines.length}개\n`);

mkdirSync(CHARS, { recursive: true });

// 캐릭터별 JSON
const written = new Set();
const taken = new Map();          // 바꾼 파일명 → 원래 이름
let renamed = 0;

for (const c of u.characters) {
  let base = safeName(c.name);
  // 이름 자체는 유일하지만 **바꾼 뒤에 겹칠 수 있다** — `가:나` 와 `가?나` 가 둘 다 `가_나` 다
  if (taken.has(base)) {
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    console.log(`  ! 파일명이 겹쳐 번호를 붙였습니다: ${c.name} → ${base}-${n}.json (원래 이름은 파일 안 name 에 남습니다)`);
    base = `${base}-${n}`;
    renamed++;
  }
  taken.set(base, c.name);

  const file = `${base}.json`;
  writeFileSync(join(CHARS, file), JSON.stringify({
    id: c.id, name: c.name, group: c.group, color: c.color,
    pos: c.pos, fields: c.fields, notes: c.notes,
  }, null, 2) + '\n', 'utf-8');
  written.add(file);
}

// 관계는 한 파일 — 여러 건을 같이 봐야 의미가 생긴다(§9)
// **빈 줄과 주석까지 그대로** 쓴다. bundle.js 가 그대로 되읽는다
writeFileSync(join(DATA, 'relations.md'), u.lines.join('\n') + '\n', 'utf-8');

console.log(`  data/characters/  ${written.size}개`);
console.log(`  data/relations.md  ${u.lines.length}줄`);

// ─────────────────────────────────────────── 남은 파일
//
// 이걸 빼면 폴더가 조용히 썩는다(§8). 지나를 지현으로 바꾸면 지현.json 이 새로
// 생기고 지나.json 은 그대로 남는다. 며칠 지나면 폴더에 없는 사람이 섞여 있고,
// 클로드가 그걸 읽으면 틀린 설정을 사실로 받아들인다.

const stale = readdirSync(CHARS).filter((f) => f.endsWith('.json') && !written.has(f));

if (stale.length) {
  console.log(`\n남은 파일 ${stale.length}개 — 이번 번들에 없는 사람입니다:`);
  for (const f of stale) console.log(`  ${f}`);
  if (clean) {
    for (const f of stale) unlinkSync(join(CHARS, f));
    console.log(`\n  --clean 이라 지웠습니다.`);
  } else {
    // 지우지는 않고 알리기만 한다 — `-` 나 `:` 가 든 이름이 파일명에서 `_` 로
    // 바뀌는 규칙과 얽혀 오판할 수 있다(§8)
    console.log(`\n  지우려면: node split.js --clean`);
    console.log(`  (이름을 바꾼 사람의 옛 파일일 수도 있으니 한 번 보고 지우세요)`);
  }
}

if (renamed) console.log(`\n파일명이 겹쳐 번호를 붙인 것 ${renamed}개.`);
console.log('');
