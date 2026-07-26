// node 러너 —  node tests/parse.test.js
//
// src/parse.js 와 src/serialize.js 는 아무것도 import 하지 않으므로(CLAUDE.md)
// import 경로에 붙는 ?v= 캐시 꼬리표에 걸리지 않는다. 그래서 node 가 그대로 읽는다.
//
// node 가 없어도 같은 케이스를 브라우저에서 돌릴 수 있다:
//   python -m http.server 8000  →  localhost:8000/tests/parse.test.html

import { tests } from './cases.js';
import { makeAsserter } from './assert.js';

let pass = 0;
const failures = [];

for (const [name, fn] of tests) {
  const t = makeAsserter();
  try {
    fn(t);
    if (t.failures.length) failures.push([name, t.failures]);
    else pass++;
  } catch (e) {
    failures.push([name, [`던져진 예외: ${e && e.stack ? e.stack : e}`]]);
  }
}

for (const [name, msgs] of failures) {
  console.log(`\x1b[31mFAIL\x1b[0m  ${name}`);
  for (const m of msgs) console.log(`        ${m}`);
}

const total = tests.length;
if (failures.length) {
  console.log(`\n${pass}/${total} 통과 — \x1b[31m${failures.length}건 실패\x1b[0m`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32m${pass}/${total} 전부 통과\x1b[0m`);
}
