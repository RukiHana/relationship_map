// main.js — 부팅 · 연결
//
// 순서: roles.json 읽기 → 모듈 붙이기 → **묻는다**(지난 작업 이어하기 / 파일 열기).
// 조용한 복원은 하지 않는다 — 그 상태에서 파일을 가져오면 「아까 그건 어디 갔지」가
// 된다(계획서 §8).

import { VERSION } from './version.js?v=20260727a';
import {
  state, subscribe, hydrate, mutate, touchUI, undo, redo, canUndo, canRedo,
  dirtyCount, markExported, parsed, vocabulary, setSaver, flushSave, byId,
} from './state.js?v=20260727a';
import {
  addCharacter, previewRename, applyRename, previewDelete, applyDelete,
  loadBundle, addSessionRole, tidyLayout,
  appendRelationLine, replaceRelationLine, deleteRelationLine,
} from './model.js?v=20260727a';
import { groupByCategory, clipboardForRepo } from './roles.js?v=20260727a';
import { serializeRelation, replaceLine } from './serialize.js?v=20260727a';
import { initText, flushText, focusOnLine, relationLinesText } from './ui_text.js?v=20260727a';
import {
  initGraph, select, toggleShowAll, setHotRelation, fitToView,
  setConnectMode, isConnectMode,
  setHiddenCategories, hiddenCategories, setQuery, centerOn, buildSVG,
  showMenu, hideMenu, menuOpen,
} from './ui_graph.js?v=20260727a';
import { pickRoles } from './ui_roles.js?v=20260727a';
import { openSheet, characterJSON } from './ui_sheet.js?v=20260727a';
import { initCard } from './ui_card.js?v=20260727a';
import {
  initIO, saveWork, loadWork, clearWork, storageWorks, pushSnapshot,
  setOtherTabHandler, exportBundle, copyText, readFile, prepareImport, describeCompare,
  canSaveInPlace, saveInPlace, savedFileName,
} from './io.js?v=20260727a';
import {
  confirmBox, alertBox, promptBox, pasteBox, selectableBox, checkListBox, notice,
} from './ui_dialog.js?v=20260727a';

const $ = (id) => document.getElementById(id);

// ─────────────────────────────────────────── 부팅

boot();

async function boot() {
  $('version').textContent = VERSION;

  await loadVocabulary();

  initIO({ onStorageFail: storageFailed });
  setSaver(saveWork);
  setOtherTabHandler(otherTabOpened);

  initText({ onFocusLine: () => {} });
  initGraph({
    onSelect: () => {},
    onEdgeOpen,
    onEdgeActivate,
    onEdgeContext,
    onNodeActivate: doSheet,
    onNodeContext,
    onConnect,
    onConnectToEmpty,
    onConnectModeChange: (on) => {
      $('btn-connect').classList.toggle('on', on);
      if (on) {
        notice({
          id: 'connect', kind: '',
          text: '연결 모드입니다 — 두 노드를 차례로 누르면 관계가 만들어집니다. 빈 곳을 누르면 무릅니다.',
        });
      } else {
        document.querySelector('[data-nid="connect"]')?.remove();
      }
    },
  });
  initCard({
    onClose: () => select(null),
    onHover: (rel) => setHotRelation(rel),
    onPickLine: (i) => focusOnLine(i),
    onRename: doRename,
    onDelete: doDelete,
    onSheet: doSheet,
    onEditLine: editRelationLine,
    onDeleteLine: removeRelationLine,
  });

  wireToolbar();
  wireDivider();
  wireDropAndPaste();
  subscribe(renderChrome);

  offerRestore();
  renderChrome();
  registerOffline();
}

/**
 * 오프라인(§10 4단계). **배포본에서만 등록한다.**
 *
 * 로컬 개발에서 켜면 `?v=` 를 안 올린 채 고친 파일이 캐시에서 나와서
 * 「고쳤는데 왜 그대로지」를 스스로 만든다 — 서비스워커를 넣는 이유가
 * 정확히 그 증상을 없애는 것인데 개발 중에는 그게 뒤집힌다.
 */
function registerOffline() {
  if (!('serviceWorker' in navigator)) return;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return;

  navigator.serviceWorker.register(`sw.js?v=${VERSION}`).then((reg) => {
    // 새 배포가 준비되면 **조용히 갈아치우지 않고 알린다.**
    // 작업 중에 화면이 새로고침되면 되돌리기 기록이 날아간다(§7).
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state !== 'installed' || !navigator.serviceWorker.controller) return;
        notice({
          id: 'update', kind: 'good', dismissable: true,
          text: '새 버전이 준비됐습니다. 지금 하던 작업을 내보낸 다음 새로고침하세요.',
          actions: [{ label: '새로고침', primary: true, onClick: () => location.reload() }],
        });
      });
    });
  }).catch(() => { /* 오프라인이 안 돼도 앱은 그대로 돈다 */ });
}

/**
 * **이걸 못 읽어도 앱은 뜬다**(§2). 파일이 없거나 JSON 이 깨졌거나 네트워크가 없으면
 * 부팅이 멈추는데, 그러면 CDN 을 금지한 바로 그 이유(흰 화면 + 아이패드에선 콘솔도
 * 못 봄)를 자기 파일로 다시 만드는 셈이다. 실패하면 빈 어휘로 시작하고 한 줄 알린다.
 */
async function loadVocabulary() {
  const empty = { categories: [], modifiers: [], roles: [] };
  try {
    const res = await fetch(`src/roles.json?v=${VERSION}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    if (!doc || !Array.isArray(doc.roles)) throw new Error('roles 배열이 없습니다');
    state.repoRoles = doc;
  } catch (e) {
    state.repoRoles = empty;
    notice({
      kind: 'warn',
      text: `관계 어휘 목록(src/roles.json)을 못 읽었습니다 — ${e.message}. `
        + '앱은 그대로 씁니다. 모르는 역할은 회색 선으로 그려집니다.',
    });
  }
}

/** 열면 위에 얇은 줄 하나를 띄운다. 한 번 고르면 사라진다(§8). */
function offerRestore() {
  const saved = loadWork();
  const actions = [{ label: '파일 열기', primary: !saved, onClick: pickFile }];

  if (saved) {
    actions.unshift({
      label: `지난 작업 이어하기 (${when(saved.savedAt)}, ${saved.characters.length}명)`,
      primary: true,
      onClick: () => {
        hydrate((s) => {
          s.characters = saved.characters;
          s.lines = saved.lines;
          s.nextId = saved.nextId;
          s.importedRoles = saved.importedRoles;
          s.sessionRoles = saved.sessionRoles;
          if (saved.ui) Object.assign(s.ui, saved.ui);
        }, { dirty: saved.dirty });
        applyRatio();
        setTimeout(() => fitToView(), 0);
      },
    });
  }

  notice({
    id: 'boot',
    text: saved ? '' : '파일을 열어 시작합니다. 데이터는 이 기기의 브라우저에만 있습니다.',
    actions,
    dismissable: !!saved,
  });
}

function when(ts) {
  if (!ts) return '언제였는지 모름';
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return `오늘 ${hm}`;
  if (days === 1) return `어제 ${hm}`;
  return `${days}일 전 ${hm}`;
}

// ─────────────────────────────────────────── 위·아래 막대

let staleWarned = false;

function renderChrome() {
  const p = parsed();
  const rels = p.relations.length;
  $('pill-count').textContent = `${state.characters.length}명 · ${rels}건`;

  const d = dirtyCount();
  const dirtyEl = $('dirty');
  dirtyEl.textContent = d ? `마지막 내보내기 이후 ${d}개 변경` : '내보낸 뒤 바뀐 것 없음';
  dirtyEl.classList.toggle('hot', d >= 20);

  let err = 0, warn = 0;
  for (const list of p.byLine.values()) {
    if (list.some((x) => x.level === 'err')) err++; else warn++;
  }
  $('diagcount').textContent = err || warn ? `· 확인할 줄 ${err + warn}개` : '';

  $('btn-undo').disabled = !canUndo();
  $('btn-redo').disabled = !canRedo();
  $('btn-showall').classList.toggle('on', state.ui.showAll);

  renderUnknownRoles();
  renderTempRoles();
  renderAmbiguous();
  renderLegend();

  // 사파리는 오래 안 쓴 사이트의 저장분을 지우는 경우가 있다(약 7일).
  // **믿고 맡길 대상이 아니다**(§8).
  if (!staleWarned && d >= 40) {
    staleWarned = true;
    notice({
      id: 'stale', kind: 'warn',
      text: `내보내지 않은 변경이 ${d}개입니다. 내보내기가 유일한 영구 기록입니다.`,
      actions: [{ label: '지금 내보내기', primary: true, onClick: doExport }],
    });
  }
}

/**
 * **모르는 역할이 나와도 막지 않는다.** 회색 선으로 그리고 「목록에 추가」를 띄운다(§5).
 * 입력을 막는 어휘는 일주일이면 안 쓰게 된다.
 */
function renderUnknownRoles() {
  const host = $('notices');
  const found = new Set();
  for (const e of parsed().entries) {
    if (e.kind !== 'relation' || !e.ok) continue;
    for (const r of [e.roleA, e.roleB]) if (r && !r.empty && !r.known) found.add(r.base);
  }
  const old = host.querySelector('[data-nid="unknown"]');
  if (!found.size) { old?.remove(); return; }

  const list = [...found];
  const text = `목록에 없는 관계명 ${list.length}개 — ${list.slice(0, 6).join(', ')}${list.length > 6 ? ' …' : ''}`;
  if (old && old.dataset.sig === text) return;
  old?.remove();

  const el = notice({
    id: 'unknown', kind: '', text,
    actions: [{ label: '목록에 추가', keep: true, onClick: () => addRoleFlow(list) }],
    dismissable: true,
  });
  el.dataset.sig = text;
}

/**
 * **얹힌 어휘는 화면에서 「임시」로 표시한다**(§5).
 * 이게 없으면 임시 어휘가 파일을 타고 몇 달을 굴러다니는데 정작 `roles.json` 은
 * 계속 비어 있다. 여기가 그 표시이자 저장소로 올리는 입구다.
 */
function renderTempRoles() {
  const host = $('notices');
  const temp = vocabulary().tempRoles;
  const old = host.querySelector('[data-nid="temp"]');
  if (!temp.length) { old?.remove(); return; }

  const text = `이 자리에서만 사는 어휘 ${temp.length}개 — ${temp.slice(0, 5).map((r) => r.label).join(', ')}${temp.length > 5 ? ' …' : ''}`;
  if (old && old.dataset.sig === text) return;
  old?.remove();

  const el = notice({
    id: 'temp', kind: '', text,
    actions: [{ label: '저장소에 넣을 것 고르기', keep: true, onClick: copyTempRoles }],
    dismissable: true,
  });
  el.dataset.sig = text;
}

/**
 * 임시 어휘 중 **고른 것만** `roles.json` 에 붙여넣을 형태로 클립보드에 담는다(§5).
 * 전부 담아주면 생각 없이 붙여넣게 되고, 그러면
 * 「세계관 고유명은 커밋 안 한다」 규칙이 없는 것과 같아진다.
 */
async function copyTempRoles() {
  const temp = vocabulary().tempRoles;
  if (!temp.length) {
    await alertBox({ title: '임시 어휘가 없습니다', message: '전부 저장소 목록에 있는 말입니다.' });
    return;
  }
  const picked = await checkListBox({
    title: '저장소에 넣을 것 고르기',
    message: 'src/roles.json 은 커밋되고 공개됩니다. 세계관 고유명이 든 어휘는 고르지 마세요. '
      + '안 고른 것도 없어지지 않습니다 — 내보낸 파일 안에서 계속 삽니다.',
    items: temp,
    renderItem: (r) => `<code>${r.label}</code> <span class="cat">${r.category ?? ''}</span>`,
  });
  if (!picked?.length) return;

  const text = clipboardForRepo(picked);
  const how = await copyText(text);
  if (how === 'manual') {
    await selectableBox({ title: 'roles.json 에 붙여넣을 것', text });
  } else {
    notice({ id: 'temp-copied', kind: 'good', text: `${picked.length}개를 클립보드에 담았습니다. src/roles.json 의 roles 배열에 붙여넣고 커밋하세요.` });
    setTimeout(() => document.querySelector('[data-nid="temp-copied"]')?.remove(), 8000);
  }
}

async function addRoleFlow(labels) {
  const vocab = vocabulary();
  const groups = groupByCategory(vocab);
  for (const label of labels) {
    const cat = await pickCategory(label, groups);
    if (cat === null) return;
    if (cat === 'skip') continue;
    const r = addSessionRole(label, cat);
    if (!r.ok) await alertBox({ title: '추가하지 못했습니다', message: r.error });
  }
}

function pickCategory(label, groups) {
  return new Promise((resolve) => {
    const back = $('modal-back');
    back.textContent = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<h2>'${label}' 을 어느 계열에 넣을까요</h2>`;
    const body = document.createElement('div');
    body.className = 'body';
    body.appendChild(Object.assign(document.createElement('p'), {
      textContent: '계열이 관계선 색을 정합니다. 이 어휘는 이 자리에서만 살고, 내보낸 파일에 같이 담깁니다.',
    }));
    for (const g of groups) {
      const b = document.createElement('button');
      b.textContent = g.category.label;
      b.style.cssText = `display:block;width:100%;text-align:left;margin:3px 0;border-left:4px solid ${g.category.color}`;
      b.addEventListener('click', () => { close(); resolve(g.category.id); });
      body.appendChild(b);
    }
    const foot = document.createElement('div');
    foot.className = 'foot';
    const skip = document.createElement('button');
    skip.textContent = '건너뛰기';
    skip.addEventListener('click', () => { close(); resolve('skip'); });
    const cancel = document.createElement('button');
    cancel.textContent = '그만두기';
    cancel.addEventListener('click', () => { close(); resolve(null); });
    foot.append(skip, cancel);
    m.append(body, foot);
    back.appendChild(m);
    back.classList.add('open');
    function close() { back.classList.remove('open'); back.textContent = ''; }
  });
}

// ─────────────────────────────────────────── 도구 막대

function wireToolbar() {
  $('btn-import').addEventListener('click', pickFile);
  $('btn-paste').addEventListener('click', pasteImport);
  $('btn-export').addEventListener('click', doExport);

  // **크롬 계열에만 있는 기능. 없으면 버튼을 숨긴다**(§8)
  if (canSaveInPlace()) {
    $('btn-save').hidden = false;
    $('btn-save').addEventListener('click', (e) => doSaveInPlace({ pickNew: e.shiftKey }));
  }
  $('btn-undo').addEventListener('click', () => { flushText(); undo(); });
  $('btn-redo').addEventListener('click', () => { flushText(); redo(); });
  $('btn-add').addEventListener('click', addCharacterFlow);

  $('btn-connect').addEventListener('click', () => setConnectMode(!isConnectMode()));
  $('btn-showall').addEventListener('click', () => { toggleShowAll(); renderChrome(); });
  $('btn-fit').addEventListener('click', () => fitToView());
  $('btn-tidy').addEventListener('click', doTidy);
  $('btn-legend').addEventListener('click', toggleLegend);
  $('btn-svg').addEventListener('click', doExportSVG);
  wireSearch();
  $('btn-collapse-graph').addEventListener('click', () => collapse('graph'));
  $('btn-collapse-list').addEventListener('click', () => collapse('list'));
  $('btn-copy-lines').addEventListener('click', copyRelationLines);

  wireKeys();

  // 손이 멎기 전 마지막 글자를 잃지 않게
  window.addEventListener('pagehide', () => { flushText(); flushSave(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushText(); flushSave(); }
  });
}

async function addCharacterFlow() {
  const name = await promptBox({
    title: '캐릭터 추가',
    message: '이름은 겹칠 수 없습니다. 관계 줄이 이름으로 적히기 때문입니다.',
    placeholder: '이름',
    validate: (v) => {
      const t = v.normalize('NFC').trim();
      if (!t) return '이름이 비었습니다';
      if (state.characters.some((c) => c.name === t)) return `'${t}' 는 이미 있습니다`;
      return null;
    },
  });
  if (name === null) return;
  const r = addCharacter(name);
  if (!r.ok) { await alertBox({ title: '추가하지 못했습니다', message: r.error }); return; }
  select(r.character.id);
}

/** 이름 변경은 「해당 줄들을 줄 단위로 교체하는 작업」이다 — 먼저 예고한다(§4). */
async function doRename(id) {
  const c = byId(id);
  if (!c) return;
  const name = await promptBox({
    title: `이름 변경 — ${c.name}`,
    message: '관계 줄은 이름으로 적히므로 이름을 바꾸면 줄도 바뀝니다. 주석 안의 이름은 건드리지 않습니다.',
    value: c.name,
    validate: (v) => previewRename(id, v).error ?? null,
  });
  if (name === null) return;

  const pre = previewRename(id, name);
  if (!pre.ok) { await alertBox({ title: '바꾸지 못했습니다', message: pre.error }); return; }

  if (pre.preview.length) {
    const ok = await confirmBox({
      title: `${pre.preview.length}개 줄이 바뀝니다`,
      message: `${pre.from} → ${pre.to}`,
      linesLabel: '이렇게 바뀝니다:',
      lines: pre.preview.map((p) => `${p.before}\n   ↓\n${p.after}`),
      okText: '바꾸기',
    });
    if (!ok) return;
  }
  applyRename(id, name);
}

/**
 * 캐릭터 시트(3단계) — 소속·색·자유 항목·메모.
 * **이름은 시트에서 못 바꾼다** — 관계 줄을 갈아끼우는 별개 작업이라 미리보기를
 * 거쳐야 한다(§4). 시트 안의 「이름 변경…」이 그 흐름으로 넘겨준다.
 */
async function doSheet(id) {
  await openSheet(id, {
    onRename: doRename,
    onDelete: doDelete,
    onCopy: async (cid, patch) => {
      // 저장 안 한 상태에서도 지금 화면의 값을 그대로 복사한다
      const text = characterJSON(cid, patch);
      const how = await copyText(text);
      if (how === 'manual') {
        await selectableBox({ title: '이 캐릭터', message: '전체 선택해 뒀습니다.', text });
      } else {
        notice({ id: 'copied-char', kind: 'good', text: '캐릭터 JSON 을 클립보드에 담았습니다.' });
        setTimeout(() => document.querySelector('[data-nid="copied-char"]')?.remove(), 4000);
      }
    },
  });
}

/** **소리 없이 지우지 않는다**(§4). 사라질 줄을 그대로 나열하고 확인받는다. */
async function doDelete(id) {
  const pre = previewDelete(id);
  if (!pre.ok) return;

  const ok = await confirmBox({
    title: `${pre.name}을(를) 지웁니다`,
    message: pre.lines.length
      ? `관계 ${pre.lines.length}줄이 함께 사라집니다. 되돌리기 한 번으로 캐릭터와 줄이 같이 돌아옵니다.`
      : '걸린 관계 줄이 없습니다.',
    lines: pre.lines,
    linesLabel: pre.lines.length ? '함께 사라지는 줄:' : null,
    okText: '지우기',
    danger: true,
  });
  if (!ok) return;
  applyDelete(id);
}

// ─────────────────────────────────────────── 가져오기 / 내보내기

function pickFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json,text/plain';
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      await importText(await readFile(f));
    } catch (e) {
      await alertBox({ title: '열지 못했습니다', message: e.message });
    }
  });
  inp.click();
}

async function pasteImport() {
  const text = await pasteBox({
    title: '번들 붙여넣기',
    message: '내보낸 charmap-….json 의 내용을 통째로 붙여넣으세요.',
  });
  if (text === null) return;
  await importText(text);
}

/** **덮어쓰기 전에 보여준다**(§8). */
async function importText(text) {
  flushText();     // 아직 안 반영된 타이핑을 먼저 밀어 넣는다(ui_text 의 userTyped 가드)
  const r = prepareImport(text);
  if (!r.ok) { await alertBox({ title: '가져오지 못했습니다', message: r.error }); return; }

  const c = r.compare;
  const msgs = [describeCompare(c)];
  if (c.exportedAt) msgs.push(`파일이 만들어진 때: ${c.exportedAt}`);
  if (c.older) msgs.push('⚠ 이 파일은 지금 브라우저에 남아 있는 작업보다 오래됐습니다. 옛 파일로 새 작업을 덮는 게 가장 흔한 사고입니다.');

  const ok = await confirmBox({
    title: '가져오면 지금 화면을 통째로 갈아치웁니다',
    message: msgs.join('\n'),
    okText: '가져오기',
    danger: c.older,
  });
  if (!ok) return;

  // 가져오기 직전 상태를 자동으로 스냅샷에 넣는다(§8)
  pushSnapshot('가져오기 직전');

  const res = loadBundle(r.data);
  applyRatio();
  setTimeout(() => fitToView(), 0);

  if (res.renamed?.length) {
    // 가져오기를 통째로 거절하면 고칠 방법이 없어진다. 막지 말고 알린다(§4)
    await alertBox({
      title: '이름이 겹쳐 뒤엣것에 번호를 붙였습니다',
      message: '이름은 겹칠 수 없습니다. 관계 줄이 어느 쪽인지 정할 방법이 없기 때문입니다.',
      lines: res.renamed.map(([a, b]) => `${a}  →  ${b}`),
    });
  }
}

async function doExport() {
  flushText();
  const r = exportBundle(vocabulary().doc);
  if (r.ok) {
    notice({ id: 'exported', kind: 'good', text: `${r.name} 로 내보냈습니다.` });
    setTimeout(() => document.querySelector('[data-nid="exported"]')?.remove(), 6000);
    return;
  }
  // 내려받기가 막히는 환경 대비(§8)
  const how = await copyText(r.text);
  if (how === 'manual') {
    await selectableBox({
      title: '내려받기가 막혔습니다',
      message: '아래 내용을 복사해 파일로 저장하세요. 전체 선택해 뒀습니다.',
      text: r.text,
    });
  } else {
    await alertBox({ title: '클립보드에 담았습니다', message: '파일 앱에 붙여넣어 저장하세요.' });
  }
  markExported();
}

/** 한 번 고른 파일에 계속 덮어쓴다. Shift 를 누르고 누르면 자리를 다시 고른다. */
async function doSaveInPlace({ pickNew = false } = {}) {
  flushText();
  const r = await saveInPlace(vocabulary().doc, { pickNew });
  if (r.cancelled) return;
  if (!r.ok) { await alertBox({ title: '저장하지 못했습니다', message: r.error }); return; }
  notice({ id: 'saved', kind: 'good', text: `${r.name} 에 저장했습니다.` });
  setTimeout(() => document.querySelector('[data-nid="saved"]')?.remove(), 5000);
}

async function copyRelationLines() {
  flushText();
  const text = relationLinesText();
  const how = await copyText(text);
  if (how === 'manual') {
    await selectableBox({ title: '관계 목록', message: '전체 선택해 뒀습니다.', text });
  } else {
    notice({ id: 'copied', kind: 'good', text: '관계 목록을 클립보드에 담았습니다.' });
    setTimeout(() => document.querySelector('[data-nid="copied"]')?.remove(), 4000);
  }
}

function wireDropAndPaste() {
  // 데스크톱 끌어다 놓기
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  window.addEventListener('dragover', stop);
  window.addEventListener('drop', async (e) => {
    stop(e);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    try { await importText(await readFile(f)); } catch { /* noop */ }
  });
}

// ─────────────────────────────────────────── 분할선

function wireDivider() {
  const div = $('divider');
  let d = null;

  div.addEventListener('pointerdown', (e) => {
    const rect = $('split').getBoundingClientRect();
    d = { top: rect.top, height: rect.height };
    div.setPointerCapture(e.pointerId);
    div.classList.add('dragging');
  });
  div.addEventListener('pointermove', (e) => {
    if (!d) return;
    const r = Math.max(0, Math.min(100, ((e.clientY - d.top) / d.height) * 100));
    state.ui.ratio = r;
    state.ui.collapsed = r < 6 ? 'graph' : r > 94 ? 'list' : null;
    applyRatio();
  });
  const end = () => {
    if (!d) return;
    d = null;
    div.classList.remove('dragging');
    // 비율은 임시 보관에 같이 넣어 다음에 열 때 유지한다(§7)
    touchUI(() => {});
    flushSave();
  };
  div.addEventListener('pointerup', end);
  div.addEventListener('pointercancel', end);

  applyRatio();
}

/** 아이패드에서는 가는 경계선을 손가락으로 집기 어려우니 **접기 버튼을 따로 둔다**(§7). */
function collapse(which) {
  const cur = state.ui.collapsed;
  touchUI((ui) => {
    ui.collapsed = cur === which ? null : which;
    if (ui.collapsed === null && (ui.ratio < 8 || ui.ratio > 92)) ui.ratio = 65;
  });
  applyRatio();
  flushSave();
}

// **완전히 숨기지 않는다. 접힌 쪽도 손잡이는 남아서 되돌릴 방법이 늘 보인다**(§7).
// 그래서 0 이 아니라 도구 줄 높이만큼 남긴다.
const GRAPH_STUB = 46;
const LIST_STUB = 34;

/**
 * ⚠ **인라인 flex 를 반드시 같이 고쳐야 한다.** 클래스만 토글하면 앞서 넣어둔
 *   인라인 `flex: 35 1 0%` 가 이겨서 **접기가 아무 일도 안 한다** —
 *   접기 버튼도 분할선 끝까지 밀기도 둘 다 안 먹었다. 실제로 그랬다.
 */
function applyRatio() {
  const g = $('graph-pane'), l = $('list-pane');
  const c = state.ui.collapsed;
  g.classList.toggle('collapsed', c === 'graph');
  l.classList.toggle('collapsed', c === 'list');

  if (c === 'graph') {
    g.style.flex = `0 0 ${GRAPH_STUB}px`;
    l.style.flex = '1 1 auto';
  } else if (c === 'list') {
    g.style.flex = '1 1 auto';
    l.style.flex = `0 0 ${LIST_STUB}px`;
  } else {
    const r = Math.max(8, Math.min(92, state.ui.ratio || 65));
    g.style.flex = `${r} 1 0%`;
    l.style.flex = `${100 - r} 1 0%`;
  }

  const gb = $('btn-collapse-graph'), lb = $('btn-collapse-list');
  gb.textContent = c === 'graph' ? '▼' : '▲';
  gb.title = c === 'graph' ? '관계도 펼치기' : '관계도 접기';
  lb.textContent = c === 'list' ? '▲' : '▼';
  lb.title = c === 'list' ? '목록 펼치기' : '목록 접기';
}

// ─────────────────────────────────────────── 4단계

/**
 * **눌렀을 때만 한 번 정렬하고 멈춘다**(§7). 물리 시뮬레이션을 켜두면 사용자가
 * 놓은 자리를 계속 밀어내서 싸움이 된다. 마음에 안 들면 되돌리기 한 번이다.
 */
function doTidy() {
  // **보이는 크기를 넘겨준다.** 안 주면 화면보다 넓게 퍼지고 `맞춤` 이 배율을
  // 0.4 근처까지 줄여서 글자를 못 읽게 만든다(§7-1 의 30명 밀도 문제)
  const g = document.getElementById('graph').getBoundingClientRect();
  const r = tidyLayout({ width: g.width, height: g.height });
  if (!r?.ok) return;
  fitToView();

  if (r.fitted) {
    notice({ id: 'tidy', kind: '', text: `${r.moved}명을 다시 놓았습니다. 마음에 안 들면 되돌리기(↶) 한 번이면 원래 자리로 갑니다.` });
    setTimeout(() => document.querySelector('[data-nid="tidy"]')?.remove(), 6000);
    return;
  }
  // 관계도가 좁으면 30명이 다 안 들어간다. **아래 목록을 접는 게 실제 해법이다** —
  // 65:35 를 100:0 으로 바꾸면 관계도 높이가 1.7배가 된다
  notice({
    id: 'tidy', kind: 'warn',
    text: `${r.moved}명을 다시 놓았지만 관계도가 좁아 몇 명은 가까이 붙었습니다.`,
    actions: [
      { label: '목록 접고 다시 정리', primary: true, onClick: () => { collapse('list'); setTimeout(doTidy, 60); } },
    ],
  });
}

/** 계열 범례 — 줄을 누르면 그 계열의 **선만** 감춘다. 노드는 그대로 둔다. */
function toggleLegend() {
  const box = $('legend');
  box.hidden = !box.hidden;
  $('btn-legend').classList.toggle('on', !box.hidden);
  if (!box.hidden) renderLegend();
}

function renderLegend() {
  const box = $('legend');
  if (box.hidden) return;
  const vocab = vocabulary();
  const hidden = hiddenCategories();

  // 지금 실제로 쓰이는 계열만 센다 — 205개 어휘의 계열을 다 띄우면 목록이 된다
  const used = new Map();
  for (const rel of parsed().relations) {
    const k = rel.category ?? '_unknown';
    used.set(k, (used.get(k) ?? 0) + 1);
  }

  box.textContent = '';
  if (!used.size) {
    const e = document.createElement('div');
    e.className = 'hint';
    e.textContent = '아직 관계가 없습니다.';
    box.appendChild(e);
    return;
  }

  for (const [catId, n] of [...used.entries()].sort((a, b) => b[1] - a[1])) {
    const cat = vocab.doc.categories.find((c) => c.id === catId)
      ?? { id: catId, label: catId === '_unknown' ? '목록에 없는 말' : catId, color: '#b6bcc4', style: 'solid' };
    const row = document.createElement('div');
    row.className = `row${hidden.has(catId) ? ' off' : ''}`;
    row.title = hidden.has(catId) ? '눌러서 다시 보이기' : '눌러서 이 계열의 선 감추기';

    const sw = document.createElement('span');
    sw.className = `sw${(cat.style ?? 'solid') !== 'solid' ? ' dashed' : ''}`;
    sw.style.color = cat.color;
    sw.style.background = (cat.style ?? 'solid') === 'solid' ? cat.color : '';
    const nm = document.createElement('span');
    nm.textContent = cat.label;
    const cnt = document.createElement('span');
    cnt.className = 'n';
    cnt.textContent = n;
    row.append(sw, nm, cnt);

    row.addEventListener('click', () => {
      const next = hiddenCategories();
      next.has(catId) ? next.delete(catId) : next.add(catId);
      setHiddenCategories(next);
      renderLegend();
    });
    box.appendChild(row);
  }

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '줄을 누르면 그 계열의 선이 숨습니다. 노드는 그대로 있습니다.';
  box.appendChild(hint);
}

// ─────────────────────────────────────────── 단축키 (5단계)

const TYPING = new Set(['INPUT', 'TEXTAREA']);

/**
 * 텍스트 칸 안에서는 조합키만 받는다 — 한글을 치는 중에 `/` 가 검색으로 튀면
 * 그건 단축키가 아니라 사고다.
 */
function wireKeys() {
  window.addEventListener('keydown', (e) => {
    const typing = TYPING.has(e.target?.tagName);
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape') { onEscape(); return; }

    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        // 텍스트 칸 안에서는 브라우저 기본 되돌리기가 더 자연스럽다
        if (typing) return;
        e.preventDefault(); flushText(); undo(); return;
      }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); flushText(); redo(); return; }
      if (k === 's') { e.preventDefault(); canSaveInPlace() ? doSaveInPlace() : doExport(); return; }
      if (k === 'f') { e.preventDefault(); focusSearch(); return; }
      return;
    }

    if (typing) return;
    if (e.key === '/') { e.preventDefault(); focusSearch(); }
    if (e.key === '?') { e.preventDefault(); showKeys(); }
  });
}

/** Esc 는 가장 안쪽부터 하나씩 벗긴다 — 메뉴 → 창 → 검색 → 연결 모드 → 선택. */
function onEscape() {
  if (menuOpen()) { hideMenu(); return; }
  const back = $('modal-back');
  if (back.classList.contains('open')) {
    const b = [...back.querySelectorAll('.foot button')]
      .find((x) => ['취소', '닫기', '그만두기'].includes(x.textContent));
    b?.click();
    return;
  }
  const search = $('search');
  if (search.value) { search.value = ''; setQuery(''); search.blur(); return; }
  if (isConnectMode()) { setConnectMode(false); return; }
  if (state.ui.focusId) select(null);
}

function focusSearch() {
  const s = $('search');
  s.focus();
  s.select();
}

function showKeys() {
  alertBox({
    title: '단축키',
    message: [
      'Esc      창 닫기 → 검색 지우기 → 연결 모드 끄기 → 선택 풀기',
      '/        인물 찾기',
      'Ctrl+F   인물 찾기',
      'Ctrl+S   저장 (없으면 데이터 내보내기)',
      'Ctrl+Z   되돌리기   ·   Ctrl+Shift+Z  다시',
      '?        이 목록',
      '',
      '텍스트 칸 안에서는 Ctrl 조합만 듣습니다 — 한글을 치는 중에 튀지 않게.',
    ].join('\n'),
  });
}

// ─────────────────────────────────────────── 파서 모호성 해결 (5단계)

/**
 * §6 은 「여러 개가 맞으면 어느 쪽인지 묻는다」고 정했다. 1단계에서는 표시만 하고
 * 앞엣것으로 읽어뒀는데, 여기가 그 「묻는」 자리다.
 *
 * 고른 결과는 **그 줄 하나만** 따옴표를 붙여 갈아끼운다(§4).
 * 한 번 감싸두면 영원히 안 헷갈린다(§6-4).
 */
async function resolveAmbiguous() {
  const items = [];
  for (const e of parsed().entries) {
    if (e.kind !== 'relation' || !e.ok) continue;
    const d = e.diagnostics.find((x) => x.code === 'ambiguous-names' && x.options);
    if (d) items.push({ entry: e, options: d.options });
  }
  if (!items.length) return;

  for (const { entry, options } of items) {
    const picked = await pickSplit(entry, options);
    if (picked === null) return;                  // 그만두기
    if (picked === 'skip') continue;
    const [a, b] = picked;
    const line = serializeRelation({ nameA: a, nameB: b, roleA: entry.roleA, roleB: entry.roleB });
    mutate(`모호성 해결 — ${a}-${b}`, (s) => { s.lines = replaceLine(s.lines, entry.lineIndex, line); });
  }
}

function pickSplit(entry, options) {
  return new Promise((resolve) => {
    const back = $('modal-back');
    back.textContent = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<h2>이 줄은 두 가지로 읽힙니다</h2>';

    const body = document.createElement('div');
    body.className = 'body';
    const pre = document.createElement('div');
    pre.className = 'lines';
    pre.textContent = entry.raw;
    body.append(
      Object.assign(document.createElement('p'), { textContent: '어느 쪽이 맞습니까? 고르면 그 줄에만 따옴표를 붙여 확정합니다.' }),
      pre,
    );

    for (const [a, b] of options) {
      const btn = document.createElement('button');
      btn.style.cssText = 'display:block;width:100%;text-align:left;margin:3px 0;font-family:var(--mono);font-size:11.5px';
      btn.textContent = serializeRelation({ nameA: a, nameB: b, roleA: entry.roleA, roleB: entry.roleB });
      btn.addEventListener('click', () => { close(); resolve([a, b]); });
      body.append(btn);
    }

    const foot = document.createElement('div');
    foot.className = 'foot';
    const skip = document.createElement('button');
    skip.textContent = '이 줄은 건너뛰기';
    skip.addEventListener('click', () => { close(); resolve('skip'); });
    const cancel = document.createElement('button');
    cancel.textContent = '그만두기';
    cancel.addEventListener('click', () => { close(); resolve(null); });
    foot.append(skip, cancel);

    m.append(body, foot);
    back.append(m);
    back.classList.add('open');

    function close() { back.classList.remove('open'); back.textContent = ''; }
  });
}

function renderAmbiguous() {
  const host = $('notices');
  const n = parsed().entries.filter(
    (e) => e.kind === 'relation' && e.diagnostics.some((d) => d.code === 'ambiguous-names'),
  ).length;
  const old = host.querySelector('[data-nid="ambig"]');
  if (!n) { old?.remove(); return; }

  const text = `두 가지로 읽히는 줄이 ${n}개 있습니다. 앞엣것으로 읽는 중입니다.`;
  if (old && old.dataset.sig === text) return;
  old?.remove();
  const el = notice({
    id: 'ambig', kind: 'warn', text,
    actions: [{ label: '어느 쪽인지 정하기', keep: true, onClick: resolveAmbiguous }],
    dismissable: true,
  });
  el.dataset.sig = text;
}

/** 인물 찾기 — 초성도 받는다. Enter 면 첫 번째를 골라 화면 가운데로. */
function wireSearch() {
  const input = $('search');
  let hits = [];
  input.addEventListener('input', () => { hits = setQuery(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; setQuery(''); input.blur(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!hits.length) return;
    select(hits[0].id);
    centerOn(hits[0].id);
  });
}

/** **`전체 보기` 상태를 뽑는다**(§7) — 기본 상태를 뽑으면 점 30개짜리 그림이 나온다. */
async function doExportSVG() {
  flushText();
  const svg = buildSVG();
  if (!svg) { await alertBox({ title: '뽑을 게 없습니다', message: '먼저 인물을 만들어주세요.' }); return; }

  const name = `charmap-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.svg`;
  try {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    notice({ id: 'svg', kind: 'good', text: `${name} 로 뽑았습니다.` });
    setTimeout(() => document.querySelector('[data-nid="svg"]')?.remove(), 5000);
  } catch {
    const how = await copyText(svg);
    if (how === 'manual') await selectableBox({ title: '관계도 SVG', message: '전체 선택해 뒀습니다.', text: svg });
  }
}

// ─────────────────────────────────────────── 선을 눌렀을 때(3단계)

function onEdgeOpen(rels) {
  if (!rels?.length) return;
  focusOnLine(rels[0].lineIndex);
}

// ─────────────────────────────────────────── 관계도에서 바로 고치기
//
// **여기서 새 편집 경로를 만들지 않는다.** 전부 이미 있는 함수를 부르기만 한다 —
// §4 의 「줄 하나만 갈아끼운다」가 그 안에 들어 있고, 두 번째 경로를 만들면
// 그 규칙이 두 군데로 갈린다.

/** 선을 두 번 눌렀을 때. 관계가 하나면 바로 열고, 여럿이면 어느 줄인지 묻는다. */
function onEdgeActivate(group) {
  if (group.rels.length === 1) { editRelationLine(group.rels[0].lineIndex); return; }
  const r = group.rels[0];
  const at = midOf(group);
  showMenu(at.x, at.y, edgeMenuItems(group, { title: `${r.nameA}-${r.nameB} — 어느 관계?` }));
}

function onEdgeContext(group, x, y) {
  showMenu(x, y, edgeMenuItems(group));
}

/**
 * 같은 두 사람 사이 관계가 여럿일 수 있다(§4). 편집은 **줄 단위**이므로
 * 줄마다 묶어서 나열한다 — 관계가 하나면 제목 없이 항목 셋이다.
 */
function edgeMenuItems(group, { title = null } = {}) {
  const items = [];
  if (title) items.push({ title });

  group.rels.forEach((rel, i) => {
    if (group.rels.length > 1) {
      if (i > 0) items.push({ divider: true });
      items.push({ title: rel.raw });
    }
    items.push({ label: '고치기', onClick: () => editRelationLine(rel.lineIndex) });
    items.push({ label: '지우기', danger: true, onClick: () => removeRelationLine(rel.lineIndex) });
    items.push({ label: '텍스트에서 보기', onClick: () => focusOnLine(rel.lineIndex) });
  });
  return items;
}

/** 더블클릭에는 좌표가 안 넘어오므로 그 선의 가운데를 화면 좌표로 계산한다. */
function midOf(group) {
  const r = $('graph').getBoundingClientRect();
  const { tx, ty, scale } = state.ui;
  const a = byId(group.rels[0].idA)?.pos ?? [0, 0];
  const b = byId(group.rels[0].idB)?.pos ?? [0, 0];
  return {
    x: r.left + tx + ((a[0] + b[0]) / 2) * scale,
    y: r.top + ty + ((a[1] + b[1]) / 2) * scale,
  };
}

function onNodeContext(id, x, y) {
  const c = byId(id);
  if (!c) return;
  showMenu(x, y, [
    { title: c.name },
    { label: '시트', onClick: () => doSheet(id) },
    { label: '이름 변경', onClick: () => doRename(id) },
    { divider: true },
    { label: '삭제', danger: true, onClick: () => doDelete(id) },
  ]);
}

// ─────────────────────────────────────────── 관계 만들기 (2단계)

/**
 * 두 인물이 정해졌다 → 역할 선택창 → **텍스트에 줄 하나 추가**(§4).
 * 관계도가 텍스트를 다시 써내는 일은 없다. 늘 한 줄이다.
 */
async function onConnect(idA, idB) {
  const a = byId(idA), b = byId(idB);
  if (!a || !b) return;

  const picked = await pickRoles({
    title: '관계 정하기',
    nameA: a.name, nameB: b.name,
    idA, idB,
  });
  if (!picked) return;

  const { index } = appendRelationLine(a.name, b.name, picked.roleA, picked.roleB);
  select(idA);
  focusOnLine(index);
}

/** **빈 곳에 놓으면 거기에 새 캐릭터를 만들고 이름 입력으로 넘어간다**(§7). */
async function onConnectToEmpty(fromId, x, y) {
  const from = byId(fromId);
  if (!from) return;

  const name = await promptBox({
    title: '새 캐릭터',
    message: `${from.name} 와(과) 이을 사람을 만듭니다.`,
    placeholder: '이름',
    validate: (v) => {
      const t = v.normalize('NFC').trim();
      if (!t) return '이름이 비었습니다';
      if (state.characters.some((c) => c.name === t)) return `'${t}' 는 이미 있습니다`;
      return null;
    },
  });
  if (name === null) return;

  const r = addCharacter(name, [Math.round(x), Math.round(y)]);
  if (!r.ok) { await alertBox({ title: '만들지 못했습니다', message: r.error }); return; }
  await onConnect(fromId, r.character.id);
}

/** 이미 있는 줄의 역할만 바꾼다 — **그 줄 하나만** 갈아끼운다(§4). */
async function editRelationLine(lineIndex) {
  const e = parsed().entries[lineIndex];
  if (!e || e.kind !== 'relation' || !e.ok) return;

  const picked = await pickRoles({
    title: '관계 고치기',
    nameA: e.nameA, nameB: e.nameB,
    idA: e.idA, idB: e.idB,
    roleA: e.roleA?.text, roleB: e.roleB?.text,
  });
  if (!picked) return;

  const r = replaceRelationLine(lineIndex, picked.roleA, picked.roleB);
  if (!r.ok) { await alertBox({ title: '못 고쳤습니다', message: r.error }); return; }
  focusOnLine(lineIndex);
}

async function removeRelationLine(lineIndex) {
  const line = state.lines[lineIndex];
  const ok = await confirmBox({
    title: '이 관계를 지웁니다',
    message: '이 줄 하나만 사라집니다. 되돌리기 한 번으로 돌아옵니다.',
    lines: [line],
    okText: '지우기',
    danger: true,
  });
  if (!ok) return;
  deleteRelationLine(lineIndex);
}

// ─────────────────────────────────────────── 사고 대비

function storageFailed(e) {
  notice({
    id: 'storage', kind: 'warn', dismissable: false,
    text: `브라우저 임시 보관이 안 됩니다 (${e?.name ?? '알 수 없음'}). 자동 보관을 껐습니다. `
      + '지금 하는 작업은 내보내기 전까지 어디에도 안 남습니다.',
    actions: [{ label: '지금 내보내기', primary: true, keep: true, onClick: doExport }],
  });
}

let tabWarned = false;
function otherTabOpened() {
  if (tabWarned) return;
  tabWarned = true;
  notice({
    id: 'tabs', kind: 'warn',
    text: '이 앱을 다른 탭에서도 열었습니다. 나중에 저장하는 쪽이 앞 탭을 덮어씁니다. 한쪽만 쓰세요.',
  });
}

export { }; // 모듈 표시
