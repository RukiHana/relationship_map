// ui_dialog.js — 확인·입력·선택 대화상자
//
// 계획서 §3 의 파일 목록에는 없다. 「소리 없이 지우지 않는다」(§4)·「덮어쓰기 전에
// 보여준다」(§8)·「모르는 역할을 목록에 추가」(§5)·「선 후보 목록」(§7) 네 곳이
// 전부 같은 물건을 필요로 해서 한 군데로 모았다. main.js 에 넣으면 그쪽이 부푼다.

let back;

function ensure() {
  if (!back) back = document.getElementById('modal-back');
  return back;
}

function close() {
  const b = ensure();
  b.classList.remove('open');
  b.textContent = '';
}

function shell(title) {
  const b = ensure();
  b.textContent = '';
  const m = document.createElement('div');
  m.className = 'modal';
  const h = document.createElement('h2');
  h.textContent = title;
  const body = document.createElement('div');
  body.className = 'body';
  const foot = document.createElement('div');
  foot.className = 'foot';
  m.append(h, body, foot);
  b.appendChild(m);
  b.classList.add('open');
  return { back: b, modal: m, body, foot };
}

function button(label, { primary = false, onClick } = {}) {
  const el = document.createElement('button');
  el.textContent = label;
  if (primary) el.className = 'primary';
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

function para(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

/** 줄 목록을 그대로 나열한다 — 무엇이 사라지는지 눈으로 본다(§4). */
function lineBlock(lines, cls = '') {
  const d = document.createElement('div');
  d.className = 'lines';
  for (const l of lines) {
    const s = document.createElement('div');
    if (cls) s.className = cls;
    s.textContent = l === '' ? ' ' : l;
    d.appendChild(s);
  }
  return d;
}

/**
 * 확인 대화상자. 되돌릴 수 없는 동작 앞에 둔다.
 * @returns Promise<boolean>
 */
export function confirmBox({ title, message, lines = null, linesLabel = null, okText = '확인', danger = false }) {
  return new Promise((resolve) => {
    const { body, foot } = shell(title);
    if (message) body.appendChild(para(message));
    if (lines?.length) {
      if (linesLabel) body.appendChild(para(linesLabel));
      body.appendChild(lineBlock(lines, danger ? 'del' : ''));
    }
    const done = (v) => { close(); resolve(v); };
    foot.append(
      button('취소', { onClick: () => done(false) }),
      button(okText, { primary: true, onClick: () => done(true) }),
    );
    foot.lastChild.focus();
  });
}

/** 안내만 하고 닫는다. */
export function alertBox({ title, message, lines = null }) {
  return new Promise((resolve) => {
    const { body, foot } = shell(title);
    if (message) body.appendChild(para(message));
    if (lines?.length) body.appendChild(lineBlock(lines));
    foot.append(button('닫기', { primary: true, onClick: () => { close(); resolve(); } }));
    foot.lastChild.focus();
  });
}

/**
 * 한 줄 입력. `validate` 가 문자열을 주면 그 자리에서 알리고 안 닫는다 —
 * 이름 중복은 여기서 거절된다(§4).
 */
export function promptBox({ title, message, value = '', placeholder = '', okText = '확인', validate = null }) {
  return new Promise((resolve) => {
    const { body, foot } = shell(title);
    if (message) body.appendChild(para(message));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    const err = document.createElement('div');
    err.className = 'err';
    body.append(input, err);

    const submit = () => {
      const v = input.value;
      const bad = validate ? validate(v) : null;
      if (bad) { err.textContent = bad; input.focus(); input.select(); return; }
      close();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { close(); resolve(null); }
    });
    input.addEventListener('input', () => { err.textContent = ''; });

    foot.append(
      button('취소', { onClick: () => { close(); resolve(null); } }),
      button(okText, { primary: true, onClick: submit }),
    );
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

/** 여러 줄 붙여넣기 — 사파리에서 클립보드 읽기가 막힐 때의 정상 경로다(§8). */
export function pasteBox({ title, message, okText = '가져오기' }) {
  return new Promise((resolve) => {
    const { body, foot } = shell(title);
    if (message) body.appendChild(para(message));
    const ta = document.createElement('textarea');
    ta.placeholder = '{ "format": "charmap", ... }';
    body.appendChild(ta);
    foot.append(
      button('취소', { onClick: () => { close(); resolve(null); } }),
      button(okText, { primary: true, onClick: () => { const v = ta.value; close(); resolve(v); } }),
    );
    setTimeout(() => ta.focus(), 0);
  });
}

/** 내용을 화면에 띄우고 **전체 선택해 둔다** — 클립보드 3단 대체의 마지막 칸(§8). */
export function selectableBox({ title, message, text }) {
  return new Promise((resolve) => {
    const { body, foot } = shell(title);
    if (message) body.appendChild(para(message));
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    body.appendChild(ta);
    foot.append(button('닫기', { primary: true, onClick: () => { close(); resolve(); } }));
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
  });
}

/**
 * 체크 목록. **고른 것만** 돌려준다 — 전부 담아주면 생각 없이 붙여넣게 되고,
 * 그러면 「세계관 고유명은 커밋 안 한다」 규칙이 없는 것과 같아진다(§5).
 * @returns Promise<any[] | null>
 */
export function checkListBox({ title, message, items, okText = '복사', renderItem }) {
  return new Promise((resolve) => {
    const { body, foot } = shell(title);
    if (message) body.appendChild(para(message));
    const ul = document.createElement('ul');
    ul.className = 'checklist';
    const boxes = [];
    items.forEach((it, i) => {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `chk-${i}`;
      const lab = document.createElement('label');
      lab.htmlFor = cb.id;
      lab.innerHTML = renderItem ? renderItem(it) : String(it);
      li.append(cb, lab);
      ul.appendChild(li);
      boxes.push(cb);
    });
    body.appendChild(ul);

    foot.append(
      button('전부 고르기', { onClick: () => boxes.forEach((b) => { b.checked = true; }) }),
      button('취소', { onClick: () => { close(); resolve(null); } }),
      button(okText, {
        primary: true,
        onClick: () => {
          const picked = items.filter((_, i) => boxes[i].checked);
          close();
          resolve(picked);
        },
      }),
    );
    foot.firstChild.classList.add('left');
  });
}

/** 화면 위 안내 줄. 부팅 선택 줄도 이걸로 만든다(§8). */
export function notice({ text, kind = '', actions = [], dismissable = true, id = null }) {
  const host = document.getElementById('notices');
  if (id) host.querySelector(`[data-nid="${id}"]`)?.remove();

  const el = document.createElement('div');
  el.className = `notice ${kind}`;
  if (id) el.dataset.nid = id;
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);

  for (const a of actions) {
    el.appendChild(button(a.label, {
      primary: a.primary,
      onClick: () => { if (a.keep !== true) el.remove(); a.onClick?.(); },
    }));
  }
  if (dismissable) {
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.title = '닫기';
    x.addEventListener('click', () => el.remove());
    el.appendChild(x);
  }
  host.appendChild(el);
  return el;
}
