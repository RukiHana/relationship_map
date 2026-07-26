// ui_sheet.js — 캐릭터 시트 폼
//
// 계획서 §10 의 3단계. 이름·소속·색만 실제로 쓰고 **나머지는 자유 항목으로 둔다**(§12).
// 고정 항목 목록이 정해지면 그때 템플릿으로 박는다.
//
// 한글 입력 안전(§2) — 이 파일이 지키는 방식:
//   **입력하는 동안 앱은 이 폼을 다시 그리지 않는다.** 값은 저장할 때 DOM 에서
//   한 번에 읽는다. 그래서 draft 상태와 화면이 어긋날 일도, 조합 중에 input 이
//   다시 만들어질 일도 없다. 항목 순서를 바꿀 때도 **input 노드를 그대로 옮긴다** —
//   다시 만들면 그 칸에 조합 중이던 글자가 날아간다.
//
// 시트 한 번 저장 = 되돌리기 `1개`(§8).

import { byId } from './state.js?v=20260726d';
import { updateCharacter, groupNames, groupColor } from './model.js?v=20260726d';

const SWATCHES = [
  ['자동', null],
  ['청회 1', 'var(--grp-0)'],
  ['청회 2', 'var(--grp-1)'],
  ['청회 3', 'var(--grp-2)'],
  ['청회 4', 'var(--grp-3)'],
  ['청회 5', 'var(--grp-4)'],
  ['청회 6', 'var(--grp-5)'],
];

/**
 * @param {string} id
 * @param {object} hooks  { onRename, onDelete, onCopy }
 * @returns Promise<boolean>  저장했으면 true
 */
export function openSheet(id, hooks = {}) {
  const c = byId(id);
  if (!c) return Promise.resolve(false);

  return new Promise((resolve) => {
    const back = document.getElementById('modal-back');
    back.textContent = '';

    const modal = el('div', 'modal sheet-modal');
    const h = el('h2', '', `${c.name}`);
    const body = el('div', 'body');
    const foot = el('div', 'foot');

    // ── 이름은 읽기 전용이다.
    // 이름 변경은 관계 줄을 갈아끼우는 별개 작업이라 미리보기를 거쳐야 한다(§4).
    const nameRow = el('div', 'sheet-row');
    nameRow.append(label('이름'));
    const nameBox = el('div', 'sheet-name');
    nameBox.append(el('span', 'nm', c.name));
    const renameBtn = el('button', '', '이름 변경…');
    renameBtn.addEventListener('click', () => { close(false); hooks.onRename?.(id); });
    nameBox.append(renameBtn);
    nameRow.append(nameBox);
    body.append(nameRow);

    // ── 소속 — 세력은 노드 색이 맡는다(§5)
    const groupRow = el('div', 'sheet-row');
    groupRow.append(label('소속'));
    const groupInput = el('input');
    groupInput.type = 'text';
    groupInput.value = c.group ?? '';
    groupInput.placeholder = '본가 · 관청 · 무소속 …';
    groupInput.setAttribute('list', 'sheet-groups');
    const dl = el('datalist');
    dl.id = 'sheet-groups';
    for (const g of groupNames()) dl.append(Object.assign(document.createElement('option'), { value: g }));
    groupRow.append(groupInput, dl);
    body.append(groupRow);

    // ── 색 — 기본은 소속에서 자동으로 나온다. 덮어쓰고 싶을 때만 고른다
    const colorRow = el('div', 'sheet-row');
    colorRow.append(label('색'));
    const swatches = el('div', 'sheet-swatches');
    let pickedColor = c.color ?? null;
    for (const [name, value] of SWATCHES) {
      const b = el('button', 'swatch', '');
      b.title = value ? name : '소속에서 자동으로 정합니다';
      b.dataset.value = value ?? '';
      if (value) b.style.background = value;
      else { b.classList.add('auto'); b.textContent = '자동'; }
      if ((pickedColor ?? '') === (value ?? '')) b.classList.add('on');
      b.addEventListener('click', () => {
        pickedColor = value;
        for (const s of swatches.children) s.classList.toggle('on', (s.dataset.value || null) === value);
      });
      swatches.append(b);
    }
    colorRow.append(swatches);
    body.append(colorRow);

    // ── 자유 항목 — **순서 있는 쌍의 목록**(§4). 기획하다 보면 순서를 바꾸게 된다
    const fieldsRow = el('div', 'sheet-row block');
    const fh = el('div', 'sheet-label-row');
    fh.append(label('항목'));
    const addBtn = el('button', '', '+ 항목');
    addBtn.addEventListener('click', () => { rows.append(fieldRow('', '')); rows.lastChild.querySelector('input').focus(); });
    fh.append(addBtn);
    fieldsRow.append(fh);

    const rows = el('div', 'sheet-fields');
    for (const [k, v] of c.fields ?? []) rows.append(fieldRow(k, v));
    if (!(c.fields ?? []).length) rows.append(fieldRow('', ''));
    fieldsRow.append(rows);
    body.append(fieldsRow);

    // ── 메모
    const notesRow = el('div', 'sheet-row block');
    notesRow.append(label('메모'));
    const notes = el('textarea', 'sheet-notes');
    notes.value = c.notes ?? '';
    notes.rows = 4;
    notesRow.append(notes);
    body.append(notesRow);

    // ── 아래 단추들
    const copyBtn = el('button', 'left', '이 캐릭터만 복사');
    copyBtn.title = '한 명만 어디에 붙여넣을 때 (§8)';
    copyBtn.addEventListener('click', () => hooks.onCopy?.(id, collect()));

    const delBtn = el('button', '', '삭제');
    delBtn.addEventListener('click', () => { close(false); hooks.onDelete?.(id); });

    const cancel = el('button', '', '취소');
    cancel.addEventListener('click', () => close(false));

    const save = el('button', 'primary', '저장');
    save.addEventListener('click', () => {
      updateCharacter(id, collect());
      close(true);
    });

    foot.append(copyBtn, delBtn, cancel, save);
    modal.append(h, body, foot);
    back.append(modal);
    back.classList.add('open');
    setTimeout(() => groupInput.focus(), 0);

    /** **저장할 때 DOM 에서 한 번에 읽는다.** 입력 중에는 아무것도 안 건드린다. */
    function collect() {
      const fields = [...rows.children].map((r) => {
        const [k, v] = r.querySelectorAll('input');
        return [k.value, v.value];
      });
      return {
        group: groupInput.value,
        color: pickedColor,
        fields,
        notes: notes.value,
      };
    }

    function close(saved) {
      back.classList.remove('open');
      back.textContent = '';
      resolve(saved);
    }
  });
}

// ─────────────────────────────────────────── 자유 항목 한 줄

function fieldRow(k, v) {
  const row = el('div', 'sheet-field');
  const key = el('input');
  key.type = 'text';
  key.value = k;
  key.placeholder = '항목 이름';
  key.className = 'k';
  const val = el('input');
  val.type = 'text';
  val.value = v;
  val.placeholder = '값';
  val.className = 'v';

  const up = el('button', 'mini', '↑');
  up.title = '위로';
  const down = el('button', 'mini', '↓');
  down.title = '아래로';
  const del = el('button', 'mini', '✕');
  del.title = '이 항목 지우기';

  // **input 노드를 그대로 옮긴다.** 다시 만들면 조합 중이던 글자가 날아간다
  up.addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev) row.parentNode.insertBefore(row, prev);
  });
  down.addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next) row.parentNode.insertBefore(next, row);
  });
  del.addEventListener('click', () => {
    const parent = row.parentNode;
    row.remove();
    if (!parent.children.length) parent.append(fieldRow('', ''));
  });

  row.append(key, val, up, down, del);
  return row;
}

// ─────────────────────────────────────────── 도우미

function el(tag, cls = '', text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function label(text) {
  return el('span', 'sheet-label', text);
}

/**
 * `이 캐릭터만 복사` 가 뱉는 모양. split.js 가 캐릭터별로 푸는 파일과 같은 형식이다(§4).
 * (그 경로 문자열은 여기 안 적는다 — §11 의 점검이 src 안에서 그게 하나도 안 나오는
 *  것을 보는데, 설명하려고 적은 주석까지 걸리면 점검이 무뎌진다)
 */
export function characterJSON(id, patch = null) {
  const c = byId(id);
  if (!c) return '';
  return JSON.stringify({
    id: c.id,
    name: c.name,
    group: patch ? (patch.group.trim() || null) : c.group,
    color: patch ? patch.color : c.color,
    pos: c.pos,
    fields: patch
      ? patch.fields.map(([k, v]) => [k.trim(), v.trim()]).filter(([k, v]) => k || v)
      : c.fields,
    notes: patch ? patch.notes : c.notes,
  }, null, 2);
}

export { groupColor };
