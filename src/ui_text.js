// ui_text.js — 텍스트 목록 (하이라이트 pre + textarea 2층)
//
// **관계 내용의 원본은 여기다**(계획서 §4). 관계도는 이 줄들을 읽고,
// 고칠 때는 해당 줄 하나만 갈아끼운다.
//
// 한글 입력 안전(§2) — 이 파일의 제일 중요한 규칙:
//   · textarea 는 **한 번 만들고 절대 다시 만들지 않는다.** index.html 의 그 노드 그대로 산다
//   · 타이핑 경로에서 앱은 `textarea.value` 를 **절대 건드리지 않는다**
//   · 조합(compositionstart~end) 중에는 파싱을 미루되,
//     **조합 종료만 믿지 않는다** — 입력이 멎으면 조합 여부와 무관하게 파싱하는 타이머를 같이 둔다
//   · 하이라이트 pre 는 입력이 없는 층이라 언제든 다시 그려도 안전하다

import { state, parsed, subscribe } from './state.js?v=20260727a';
import { applyLines } from './model.js?v=20260727a';

const QUIET_MS = 200;         // 손이 멎었다고 볼 시간
const COMPOSE_GUARD_MS = 600; // 조합 이벤트가 안 올 때의 대비(위)

let src, hl, wrap;
let composing = false;
let quietTimer = 0;
let guardTimer = 0;
let selfWrite = false;        // 앱이 value 를 쓴 직후의 input 이벤트를 구분한다
let userTyped = false;        // ★ 아래 commit() 의 안전장치
let onLineFocus = null;       // 카드에서 줄을 눌렀을 때 알려줄 곳
let focusLine = -1;

export function initText({ onFocusLine } = {}) {
  src = document.getElementById('src');
  hl = document.getElementById('hl');
  wrap = document.getElementById('text-wrap');
  onLineFocus = onFocusLine ?? null;

  src.addEventListener('input', onInput);
  src.addEventListener('compositionstart', () => { composing = true; });
  src.addEventListener('compositionend', () => { composing = false; schedule(QUIET_MS); });
  src.addEventListener('scroll', syncScroll, { passive: true });
  src.addEventListener('click', clearFocusLine);
  src.addEventListener('keydown', clearFocusLine);

  // 창 크기가 바뀌면 줄바꿈 위치가 달라진다 — 배경 층을 다시 깐다
  window.addEventListener('resize', () => renderHighlight());

  subscribe(render);
  render();
}

// ─────────────────────────────────────────── 입력 → 상태

function onInput() {
  if (selfWrite) { selfWrite = false; return; }
  userTyped = true;
  clearFocusLine();
  schedule(composing ? COMPOSE_GUARD_MS : QUIET_MS);
}

/**
 * 조합 중이면 더 길게 기다리되 **결국은 판다.**
 * 조합 이벤트가 늦게 오거나 안 오는 기기가 있어서, 종료 신호만 믿으면
 * 그 기기에서는 타이핑한 내용이 관계도에 영영 안 반영된다.
 */
function schedule(ms) {
  clearTimeout(quietTimer);
  quietTimer = setTimeout(commit, ms);

  clearTimeout(guardTimer);
  guardTimer = setTimeout(commit, COMPOSE_GUARD_MS + QUIET_MS);
}

/**
 * ★ **사용자가 실제로 친 경우에만 반영한다.**
 *
 * 이 가드가 없으면 이런 사고가 난다: 탭이 뒤에 있어 다시그리기가 밀리는 동안
 * textarea 는 아직 상태와 동기되기 전(빈 값)인데, 그 상태로 페이지를 떠나면
 * pagehide → flushText → commit 이 **빈 값을 원본으로 믿고 관계 줄을 통째로
 * 지운다.** 실제로 개발 중에 12줄이 이렇게 날아갔다.
 *
 * 원본이 텍스트라는 규칙(§4)은 「사용자가 텍스트에 쓴 것이 원본」이라는 뜻이지
 * 「DOM 노드의 현재 값이 무조건 이긴다」는 뜻이 아니다.
 */
function commit() {
  clearTimeout(quietTimer);
  clearTimeout(guardTimer);
  if (!userTyped) return;
  const lines = src.value.split('\n');
  userTyped = false;
  if (sameLines(lines, state.lines)) { renderHighlight(); return; }
  applyLines(lines);
}

/** 화면을 떠나거나 내보내기 직전에 부른다 — 손이 멎기 전 마지막 글자를 잃지 않게. */
export function flushText() {
  if (!src) return;
  commit();
}

function sameLines(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ─────────────────────────────────────────── 상태 → 화면

/**
 * **상태 → 텍스트 경로는 가져오기·삭제·이름변경 셋뿐이다**(§4).
 * 전부 사용자가 확인을 누른 직후라 조합 중일 수 없다. 그때만 value 를 쓴다.
 */
function render() {
  if (!src) return;
  const want = state.lines.join('\n');
  // 아직 반영 안 된 타이핑이 있으면 덮지 않는다 — 위 commit() 가드의 거울이다.
  // 이게 없으면 다른 곳에서 일어난 변경 하나가 치던 글자를 지운다.
  if (src.value !== want && !composing && !userTyped) {
    const at = src.selectionStart;
    selfWrite = true;
    src.value = want;
    const p = Math.min(at, want.length);
    try { src.setSelectionRange(p, p); } catch { /* 포커스가 없으면 무시 */ }
  }
  renderHighlight();
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 배경만 칠하는 층. 글자는 textarea 가 그린다(style.css 의 긴 주석 참조).
 * 줄바꿈이 두 층에서 똑같이 일어나야 하므로 **같은 글자를 같은 폭으로 넣는다** —
 * 보이지만 않을 뿐 내용은 동일하다.
 */
function renderHighlight() {
  if (!hl) return;
  const p = parsed();
  const lines = state.lines.length ? state.lines : [''];

  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const diags = p.byLine.get(i) ?? [];
    let cls = '';
    if (i === focusLine) cls = 'focus';
    else if (diags.some((d) => d.level === 'err')) cls = 'err';
    else if (diags.length) cls = 'warn';
    // 빈 줄도 높이를 차지해야 아래 줄들이 안 밀린다
    out += `<span class="ln ${cls}">${esc(lines[i]) || '​'}</span>`;
  }
  hl.innerHTML = out;
  syncScroll();
}

function syncScroll() {
  if (!hl || !src) return;
  hl.scrollTop = src.scrollTop;
  hl.scrollLeft = src.scrollLeft;
}

// ─────────────────────────────────────────── 줄로 이동 (카드 ↔ 텍스트)

/**
 * 카드의 줄을 누르면 **아래 텍스트의 그 줄로 이동 + 강조**된다(§7).
 * 줄높이가 고정(24px)이라 자리를 정확히 계산할 수 있다 — 디자인이 여기서 값을 한다.
 */
export function focusOnLine(index) {
  if (!src || index < 0 || index >= state.lines.length) return;
  focusLine = index;

  const before = state.lines.slice(0, index).join('\n');
  const start = before.length + (index > 0 ? 1 : 0);
  const end = start + state.lines[index].length;

  src.focus({ preventScroll: true });
  try { src.setSelectionRange(start, end); } catch { /* noop */ }

  // 강조한 줄이 화면 가운데쯤 오게
  const lh = parseFloat(getComputedStyle(src).lineHeight) || 24;
  const pad = parseFloat(getComputedStyle(src).paddingTop) || 14;
  const target = pad + index * lh - src.clientHeight / 2 + lh;
  src.scrollTop = Math.max(0, target);

  renderHighlight();
  onLineFocus?.(index);
}

function clearFocusLine() {
  if (focusLine === -1) return;
  focusLine = -1;
  renderHighlight();
}

/** 관계 줄만 골라 텍스트로 (기획서에 바로 붙여넣기 — §8). */
export function relationLinesText() {
  return parsed().entries
    .filter((e) => e.kind === 'relation')
    .map((e) => e.raw)
    .join('\n');
}
