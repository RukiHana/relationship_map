// ui_card.js — 관계 카드 (읽기 전용) · 선 ↔ 줄 양방향 연결
//
// **읽기 전용인 것이 중요하다**(계획서 §7). 아래 텍스트 영역을 걸러서 보여주고
// 싶어지지만 그러면 안 된다 — 편집 가능한 원본을 다시 채우면 한글 조합 중에
// 글자가 먹고, 걸러진 줄 번호가 실제 줄 번호와 어긋나 「줄 하나만 갈아끼운다」가
// 무너진다. 카드는 입력이 없으므로 마음대로 다시 그려도 안전하다.
//
// **선 클릭 판정이 완벽하지 않아도 되는 이유가 이 카드다.** 없으면 정확도에
// 목을 매야 하는데, 있으면 최선을 다하고 실패해도 그만이다.

import { state, adjacency, subscribe, byId } from './state.js?v=20260726e';

let box, hooks = {};

export function initCard(opts = {}) {
  hooks = opts;
  box = document.getElementById('card');
  subscribe(render);
  render();
}

function render() {
  if (!box) return;
  const id = state.ui.focusId;
  if (!id) { box.classList.remove('open'); box.textContent = ''; return; }

  const c = byId(id);
  if (!c) { box.classList.remove('open'); return; }
  const rels = adjacency().get(id)?.rels ?? [];

  box.textContent = '';

  const head = document.createElement('div');
  head.className = 'head';
  const nm = document.createElement('span');
  nm.textContent = c.name;
  const cnt = document.createElement('span');
  cnt.className = 'count';
  cnt.textContent = `· 관계 ${rels.length}건`;
  const x = document.createElement('button');
  x.className = 'x';
  x.title = '닫기';
  x.textContent = '×';
  x.addEventListener('click', () => hooks.onClose?.());
  head.append(nm, cnt, x);
  box.appendChild(head);

  // 카드가 **관계 줄**에 대해 읽기 전용이라는 것과, 이 인물 자체를 고치는 것은 다른 일이다.
  // 이름 변경·삭제는 둘 다 미리보기와 확인을 거친다(§4).
  const acts = document.createElement('div');
  acts.className = 'card-acts';
  const sheet = document.createElement('button');
  sheet.textContent = '시트';
  sheet.title = '소속·색·항목·메모';
  sheet.addEventListener('click', () => hooks.onSheet?.(id));
  const rename = document.createElement('button');
  rename.textContent = '이름 변경';
  rename.addEventListener('click', () => hooks.onRename?.(id));
  const del = document.createElement('button');
  del.textContent = '삭제';
  del.addEventListener('click', () => hooks.onDelete?.(id));
  acts.append(sheet, rename, del);
  box.appendChild(acts);

  if (!rels.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '아직 아무하고도 안 엮였습니다.';
    box.appendChild(e);
  } else {
    const ul = document.createElement('ul');
    for (const rel of rels) {
      const li = document.createElement('li');
      const txt = document.createElement('span');
      txt.className = 'ln-text';
      txt.textContent = rel.raw;                       // **원본 줄 그대로**
      li.appendChild(txt);
      if (rel.diagnostics.some((d) => d.level === 'err')) li.classList.add('err');

      // 여기서 고쳐도 **그 줄 하나만** 갈아끼운다(§4). 카드가 관계 줄을
      // 다시 채우지 않는 것과 이건 다른 얘기다 — 버튼은 입력이 아니다.
      const acts = document.createElement('span');
      acts.className = 'ln-acts';
      for (const [label, hook] of [['고치기', 'onEditLine'], ['지우기', 'onDeleteLine']]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); hooks[hook]?.(rel.lineIndex); });
        acts.appendChild(b);
      }
      li.appendChild(acts);

      // 카드의 줄에 손을 올리면 해당 선이 굵어진다 — 이 역방향 연결이
      // 선 겹침 문제의 최종 안전망이다(§7)
      li.addEventListener('pointerenter', () => hooks.onHover?.(rel));
      li.addEventListener('pointerleave', () => hooks.onHover?.(null));
      // 누르면 아래 텍스트의 그 줄로 이동 + 강조. **고칠 때는 언제나 원본에서 고친다**
      li.addEventListener('click', () => hooks.onPickLine?.(rel.lineIndex));

      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  box.classList.add('open');
}
