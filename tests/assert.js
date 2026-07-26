// 의존성 없는 단언 도구. 두 러너가 공유한다.
// 한 케이스 안에서 실패해도 멈추지 않고 모아서 보고한다 — 한 번에 여러 개를 본다.

function show(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function makeAsserter() {
  const failures = [];
  return {
    failures,
    ok(cond, msg = '') {
      if (!cond) failures.push(`거짓입니다${msg ? ` — ${msg}` : ''}`);
    },
    eq(actual, expected, msg = '') {
      if (!Object.is(actual, expected)) {
        failures.push(`${show(expected)} 를 기대했는데 ${show(actual)} 입니다${msg ? ` — ${msg}` : ''}`);
      }
    },
    deep(actual, expected, msg = '') {
      const a = show(actual), b = show(expected);
      if (a !== b) failures.push(`${b} 를 기대했는데 ${a} 입니다${msg ? ` — ${msg}` : ''}`);
    },
  };
}
