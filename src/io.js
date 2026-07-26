// io.js — 가져오기/내보내기 · 임시 보관 · 스냅샷 · 클립보드 3단 대체
//
// **파일이 원본이고, 브라우저 저장은 작업 중 임시 보관이다**(계획서 §8).
// 매 작업은 파일을 여는 것으로 시작하고 파일로 내보내며 끝난다.
// 브라우저에 남는 건 그 사이가 끊겼을 때 잃지 않기 위한 것이다.
//
// ★ 이 파일은 저장소의 `data` 폴더를 읽지 않는다. 개발 중에는 로컬 서버 덕분에
//   fetch 가 성공하지만 배포본에는 그 폴더가 없어서 아이패드에서 깨진다.
//   그래서 §11 의 점검은 src 안에서 그 경로 문자열이 **하나도 안 나오는 것**을 본다.
//   설명하려고 적은 주석까지 걸리면 점검이 무뎌지므로 여기서도 안 적는다(CLAUDE.md 규칙 2).

import { state, markExported, dirtyCount } from './state.js?v=20260726d';
import { packBundle, unpackBundle, bundleFileName } from './serialize.js?v=20260726d';
import { nfc } from './parse.js?v=20260726d';

const KEY = 'charmap.work';
const SNAP_KEY = 'charmap.snap';      // 직전 상태 3개를 굴린다
const TAB_KEY = 'charmap.tab';
const SNAP_MAX = 3;

let storageOk = true;
let onStorageFail = null;

export function initIO({ onStorageFail: fail } = {}) {
  onStorageFail = fail ?? null;
  watchTabs();
}

// ─────────────────────────────────────────── 임시 보관

function payload() {
  return {
    ...packBundle({
      characters: state.characters,
      lines: state.lines,
      roles: null,                       // 어휘는 내보내기 번들에만 담는다. 임시 보관은 가볍게
      nextId: state.nextId,
    }),
    importedRoles: state.importedRoles,
    sessionRoles: state.sessionRoles,
    ui: { ratio: state.ui.ratio, collapsed: state.ui.collapsed, showAll: state.ui.showAll },
    dirty: dirtyCount(),
    savedAt: Date.now(),
  };
}

/** state.js 가 이걸 `1개` 단위 시점에 부른다 — 드래그는 놓았을 때, 타이핑은 손이 멎었을 때. */
export function saveWork() {
  if (!storageOk) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(payload()));
    return true;
  } catch (e) {
    // **쓰기가 실패하면 눈에 띄게 알린다**(§8). 조용히 실패하면 사용자는
    // 안전하다고 믿은 채로 계속 작업한다.
    storageOk = false;
    onStorageFail?.(e);
    return false;
  }
}

export function loadWork() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const u = unpackBundle(obj);
    if (!u.ok) return null;
    return {
      ...u,
      importedRoles: obj.importedRoles ?? null,
      sessionRoles: Array.isArray(obj.sessionRoles) ? obj.sessionRoles : [],
      ui: obj.ui ?? null,
      dirty: Number(obj.dirty) || 0,
      savedAt: Number(obj.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function clearWork() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

export function storageWorks() { return storageOk; }

// ─────────────────────────────────────────── 스냅샷 (되돌리기보다 오래 산다)

/**
 * 되돌리기는 새로고침하면 사라지지만 이건 남는다.
 * 잘못된 가져오기나 삭제를 하루 뒤에도 되살릴 수 있다(§8).
 */
export function pushSnapshot(label) {
  if (!storageOk) return;
  try {
    const list = readSnapshots();
    list.unshift({ label, at: Date.now(), data: payload() });
    localStorage.setItem(SNAP_KEY, JSON.stringify(list.slice(0, SNAP_MAX)));
  } catch { /* 용량이 차면 스냅샷부터 포기한다 — 본 저장이 우선이다 */ }
}

export function readSnapshots() {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// ─────────────────────────────────────────── 탭 두 개 감지(§8)

let channel = null;
let onOtherTab = null;

export function setOtherTabHandler(fn) { onOtherTab = fn; }

function watchTabs() {
  const me = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(TAB_KEY, me); } catch { /* noop */ }

  try {
    channel = new BroadcastChannel('charmap');
    channel.postMessage({ type: 'hello', me });
    channel.addEventListener('message', (e) => {
      // 뒤에 연 쪽이 인사하면, 먼저 열려 있던 이쪽이 경고를 받는다
      if (e.data?.type === 'hello' && e.data.me !== me) onOtherTab?.();
    });
  } catch { /* BroadcastChannel 이 없으면 아래 storage 이벤트로 버틴다 */ }

  window.addEventListener('storage', (e) => {
    if (e.key === TAB_KEY && e.newValue && e.newValue !== me) onOtherTab?.();
  });
}

// ─────────────────────────────────────────── 내보내기

/** **파일로 빼는 건 사용자가 누를 때만**(§8). */
export function exportBundle(vocabDoc) {
  const now = new Date();
  const bundle = packBundle({
    characters: state.characters,
    lines: state.lines,
    // **내보낼 때는 합쳐진 전체를 담는다.** 파일 하나만 있어도 모든 줄을 해석할 수 있어야 한다(§5)
    roles: vocabDoc,
    nextId: state.nextId,
  }, now);

  const text = JSON.stringify(bundle, null, 1);
  const name = bundleFileName(now);
  const ok = download(name, text);
  if (ok) markExported();
  return { ok, name, text };
}

function download(name, text) {
  try {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

/**
 * 클립보드는 3단으로 물러선다(§8):
 *   표준 API → 예전 방식 → **그것도 안 되면 내용을 화면에 띄우고 전체 선택해 둔다.**
 * 사파리는 사용자 조작과 직접 이어지지 않은 클립보드 쓰기를 거부하는 경우가 있다.
 *
 * @returns 'api' | 'legacy' | 'manual'
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'api';
    }
  } catch { /* 다음 칸으로 */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return 'legacy';
  } catch { /* 다음 칸으로 */ }

  return 'manual';   // 부르는 쪽이 selectableBox 를 띄운다
}

// ─────────────────────────────────────────── 가져오기

/** 파일 하나를 읽어 텍스트로. **읽는 즉시 NFC 정규화한다**(§4). */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    r.onload = () => resolve(nfc(String(r.result ?? '')));
    r.readAsText(file, 'utf-8');
  });
}

/** @returns {{ ok, error?, data?, compare? }} */
export function prepareImport(text) {
  let obj;
  try {
    obj = JSON.parse(nfc(String(text ?? '')));
  } catch (e) {
    return { ok: false, error: `JSON 이 아닙니다 — ${e.message}` };
  }
  const u = unpackBundle(obj);
  if (!u.ok) return { ok: false, error: u.error };

  // 가져오기는 지금 화면을 통째로 갈아치우는 동작이라 **비교를 보여준다**(§8)
  const nowChars = state.characters.length;
  const nowRels = state.lines.filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  const newRels = u.lines.filter((l) => l.trim() && !l.trim().startsWith('#')).length;

  const older = isOlder(u.exportedAt);

  return {
    ok: true,
    data: u,
    compare: {
      nowChars, newChars: u.characters.length,
      nowRels, newRels,
      exportedAt: u.exportedAt,
      older,
    },
  };
}

/** 옛 파일로 새 작업을 덮는 게 가장 흔한 사고다(§8). */
function isOlder(exportedAt) {
  if (!exportedAt) return false;
  const saved = loadWork();
  if (!saved?.exportedAt) return false;
  const a = Date.parse(exportedAt);
  const b = Date.parse(saved.exportedAt);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

export function describeCompare(c) {
  const dc = c.newChars - c.nowChars;
  const dr = c.newRels - c.nowRels;
  const w = (n, unit) => (n === 0 ? `${unit} 그대로` : n > 0 ? `${unit} ${n} 늘어남` : `${unit} ${-n} 줄어듦`);
  return `현재 ${c.nowChars}명 / 들어올 것 ${c.newChars}명 · ${w(dc, '인물')} · ${w(dr, '관계 줄')}`;
}
