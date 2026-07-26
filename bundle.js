// bundle.js — 손으로 고친 파일들 → 번들 하나
//
//   node bundle.js
//
// split.js 의 반대 방향이다. 이 왕복이 있어야 **개별 파일을 손으로 고친 뒤 다시
// 묶어 앱에 넣는 것**이 성립한다(계획서 §8).
//
//   data/characters/*.json + data/relations.md
//                              ↓  node bundle.js
//        data/charmap-20260726-1930.json  →  앱의 「파일 열기」
//
// ★ **읽은 파일을 덮어쓰지 않는다.** 같은 이름 규칙으로 새 파일을 쓴다.
//   묶는 데 실패해도 원본이 그대로 남는다(§8).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packBundle, bundleFileName, nextIdFrom } from './src/serialize.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const CHARS = join(DATA, 'characters');

function die(msg) {
  console.error(`\n!! ${msg}\n`);
  process.exit(1);
}

if (!existsSync(CHARS)) die('data/characters 가 없습니다. 먼저 node split.js 를 돌리세요.');

// ─────────────────────────────────────────── 캐릭터

const files = readdirSync(CHARS).filter((f) => f.endsWith('.json')).sort();
if (!files.length) die('data/characters 에 json 이 없습니다.');

const characters = [];
const seen = new Map();
for (const f of files) {
  let c;
  try {
    c = JSON.parse(readFileSync(join(CHARS, f), 'utf-8'));
  } catch (e) {
    die(`${f} 를 못 읽었습니다 — ${e.message}\n   (원본은 그대로 있습니다. 그 파일만 고치고 다시 돌리세요)`);
  }
  const name = String(c?.name ?? '').normalize('NFC').trim();
  if (!name) die(`${f} 에 name 이 없습니다.`);

  // **이름은 겹칠 수 없다**(§4). 손으로 고치다 겹쳤으면 여기서 잡는 게 맞다 —
  // 앱까지 들고 가면 `-2` 가 붙어 조용히 다른 사람이 된다
  if (seen.has(name)) die(`이름이 겹칩니다: '${name}' (${seen.get(name)} 와 ${f})\n   관계 줄이 이름으로 적히므로 어느 쪽인지 정할 방법이 없습니다.`);
  seen.set(name, f);

  characters.push({
    id: c.id, name, group: c.group ?? null, color: c.color ?? null,
    pos: Array.isArray(c.pos) ? c.pos : null,
    fields: Array.isArray(c.fields) ? c.fields : [],
    notes: c.notes ?? '',
  });
}

// P01 순번대로 정렬 — 사람이 볼 일은 없지만 파일 차이가 안 흔들린다
characters.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));

// ─────────────────────────────────────────── 관계 줄

const relPath = join(DATA, 'relations.md');
let lines = [];
if (existsSync(relPath)) {
  const text = readFileSync(relPath, 'utf-8').normalize('NFC').replace(/\r\n/g, '\n');
  lines = text.split('\n');
  // 파일 끝 개행 하나는 구분자이지 빈 줄이 아니다 — 왕복할 때마다 줄이 늘면 안 된다
  if (lines.length && lines.at(-1) === '') lines.pop();
} else {
  console.log('  ! data/relations.md 가 없습니다. 관계 없이 묶습니다.');
}

// ─────────────────────────────────────────── 어휘와 nextId 물려받기
//
// 가장 최근 번들에서 가져온다. 없으면 저장소의 src/roles.json.
// **내보낼 때는 합쳐진 전체를 담는다** — 파일 하나만 있어도 모든 줄을 해석할 수
// 있어야 한다(§5).

function latestBundle() {
  const cands = readdirSync(DATA)
    .filter((f) => /^charmap.*\.json$/i.test(f))
    .map((f) => {
      try {
        const j = JSON.parse(readFileSync(join(DATA, f), 'utf-8'));
        return { f, j, at: Date.parse(j.exportedAt) || 0 };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at);
  return cands[0] ?? null;
}

const prev = latestBundle();
let roles = prev?.j?.roles ?? null;
if (!roles) {
  try { roles = JSON.parse(readFileSync(join(ROOT, 'src', 'roles.json'), 'utf-8')); } catch { roles = null; }
}

// **지운 번호는 영구 결번**(§4). 옛 번들이 들고 있던 값보다 작아지면 안 된다
const nextId = Math.max(prev?.j?.nextId ?? 0, nextIdFrom(characters));

// ─────────────────────────────────────────── 쓰기

const now = new Date();
const out = join(DATA, bundleFileName(now));
if (existsSync(out)) die(`같은 이름이 이미 있습니다: ${bundleFileName(now)}\n   1분 뒤에 다시 돌리세요 (읽은 파일을 덮어쓰지 않기 위해 멈춥니다).`);

const bundle = packBundle({ characters, lines, roles, nextId }, now);
writeFileSync(out, JSON.stringify(bundle, null, 1) + '\n', 'utf-8');

console.log(`\n묶었습니다: data/${bundleFileName(now)}`);
console.log(`  인물 ${characters.length}명 · 줄 ${lines.length}개 · 어휘 ${roles?.roles?.length ?? 0}개 · nextId ${nextId}`);
if (prev) console.log(`  물려받은 어휘/번호 출처: ${prev.f}`);
console.log(`\n앱에서 「파일 열기」로 이 파일을 넣으세요.\n`);
