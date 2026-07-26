// ui_roles.js — 역할 선택창
//
// 계획서 §3 의 파일 목록에는 없다. ui_dialog.js 에 넣기엔 이것 하나가 크고
// (검색 · 계열 접기 · 수식 · 역방향 제안), 관계도와 텍스트 양쪽에서 부른다.
//
// 규칙(§5, §7):
//   · **층위1만 펼쳐 보인다.** 2·3 계열은 접힌 채로 두고 제목만 보인다
//     층위1만 해도 90개라 전부 펼치면 고르는 화면이 아니라 읽는 화면이 된다
//   · 검색칸을 위에 둔다. **접힌 계열 안의 항목도 검색에는 걸린다** —
//     안 그러면 접기가 곧 숨기기가 된다
//   · `pair` 로 반대쪽을 자동 제안한다. **강제가 아니라 제안**이라 틀려도 손해가 없다
//   · 그룹 계열(`groupOnly`)은 흐리게 두고, 고르면 v1 에서 어떻게 되는지 알린다

import { vocabulary, adjacency, byId } from './state.js?v=20260726b';
import { groupByCategory, suggestPair } from './roles.js?v=20260726b';
import { norm } from './parse.js?v=20260726b';

const OPEN_TIER = 1;   // 항상 열려 있는 층위

/**
 * @param {object} opts
 *   nameA, nameB   — 화면에 보여줄 두 사람 이름
 *   idA, idB       — 역방향 제안에 쓸 인물 id (없어도 된다)
 *   roleA, roleB   — 고쳐 쓸 때의 현재 값 { text } 형태
 *   title          — 창 제목
 * @returns Promise<{ roleA, roleB } | null>   각 값은 `엄마(의붓)` 같은 완성된 글자
 */
export function pickRoles(opts = {}) {
  const vocab = vocabulary();
  const groups = groupByCategory(vocab);

  return new Promise((resolve) => {
    const back = document.getElementById('modal-back');
    back.textContent = '';

    const modal = el('div', 'modal roles-modal');
    modal.appendChild(el('h2', '', opts.title ?? '관계 정하기'));

    const body = el('div', 'body');
    const foot = el('div', 'foot');

    // ── 어느 쪽을 고르는 중인가
    let side = 'A';
    let picked = { A: parseInitial(opts.roleA), B: parseInitial(opts.roleB) };

    const nameA = opts.nameA ?? 'A';
    const nameB = opts.nameB ?? 'B';

    // ── 위: 지금까지 만들어진 줄 미리보기
    const preview = el('div', 'role-preview');

    // ── 어느 쪽 고르는지 탭
    const tabs = el('div', 'role-tabs');
    const tabA = el('button', 'on', '');
    const tabB = el('button', '', '');
    tabA.addEventListener('click', () => setSide('A'));
    tabB.addEventListener('click', () => setSide('B'));
    tabs.append(tabA, tabB);

    // ── 검색
    const search = el('input');
    search.type = 'text';
    search.placeholder = '관계명 검색 — 「엄」을 치면 엄마·시어머니가 걸립니다';
    search.addEventListener('input', renderList);

    // ── 수식 (폐쇄목록 6개)
    const mods = el('div', 'role-mods');
    const modBoxes = new Map();
    for (const m of vocab.doc.modifiers) {
      const id = `mod-${m}`;
      const cb = el('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.addEventListener('change', () => {
        const cur = picked[side];
        if (!cur.label) return;
        cur.mods = [...modBoxes].filter(([, b]) => b.checked).map(([k]) => k);
        renderPreview();
      });
      const lab = el('label', '', m);
      lab.htmlFor = id;
      const wrap2 = el('span', 'mod');
      wrap2.append(cb, lab);
      mods.appendChild(wrap2);
      modBoxes.set(m, cb);
    }

    const list = el('div', 'role-list');
    const hint = el('div', 'role-hint');

    body.append(preview, tabs, search, list, mods, hint);

    const cancel = el('button', '', '취소');
    cancel.addEventListener('click', () => close(null));
    const clear = el('button', 'left', '이쪽 비우기');
    clear.title = '한쪽 관계로 만듭니다 (짝사랑 등)';
    clear.addEventListener('click', () => {
      picked[side] = { label: null, mods: [] };
      syncMods();
      renderPreview();
      renderList();
    });
    const ok = el('button', 'primary', '확인');
    ok.addEventListener('click', () => {
      if (!picked.A.label && !picked.B.label) return;      // 양쪽 다 비면 관계가 아니다
      close({ roleA: compose(picked.A), roleB: compose(picked.B) });
    });
    foot.append(clear, cancel, ok);

    modal.append(body, foot);
    back.appendChild(modal);
    back.classList.add('open');

    setSide('A');
    setTimeout(() => search.focus(), 0);

    function close(v) {
      back.classList.remove('open');
      back.textContent = '';
      resolve(v);
    }

    function setSide(s) {
      side = s;
      tabA.classList.toggle('on', s === 'A');
      tabB.classList.toggle('on', s === 'B');
      syncMods();
      renderPreview();
      renderList();
      search.focus();
    }

    function syncMods() {
      const cur = picked[side];
      for (const [m, b] of modBoxes) b.checked = cur.mods.includes(m);
      for (const [, b] of modBoxes) b.disabled = !cur.label;
    }

    function renderPreview() {
      const a = compose(picked.A) || '';
      const b = compose(picked.B) || '';
      preview.textContent = `${nameA}-${nameB} : ${a} - ${b}`.replace(/\s+$/, '');
      tabA.textContent = `${nameA} 는… ${picked.A.label ? compose(picked.A) : '(고르기)'}`;
      tabB.textContent = `${nameB} 는… ${picked.B.label ? compose(picked.B) : '(고르기)'}`;
      ok.disabled = !picked.A.label && !picked.B.label;
    }

    /** 반대쪽 자동 제안 — 고르자마자 채워준다. 사용자가 바꿀 수 있다. */
    function autoFillOther(label) {
      const other = side === 'A' ? 'B' : 'A';
      if (picked[other].label) return;                     // 이미 골라둔 건 안 건드린다

      // **상대가 이미 가진 다른 관계에서 읽는다**(§12) — 당옥이 누군가의 `엄마`로
      // 적혀 있으면 `딸`의 짝으로 `엄마`를 먼저 올린다. 성별 칸 없이도 대개 맞는다
      const otherId = side === 'A' ? opts.idB : opts.idA;
      const known = otherId ? rolesUsedBy(otherId) : [];
      const s = suggestPair(vocab, label, known);
      if (s.length) picked[other] = { label: s[0], mods: [] };
    }

    function roleButton(r, color) {
      const b = el('button', 'role-btn', r.label);
      if (r.tier !== OPEN_TIER) b.classList.add('tier-off');
      if (r.groupOnly) b.classList.add('group-only');
      if (r.temp) b.classList.add('temp');
      if (r.note) b.title = r.note;                        // §7 용어 정의 툴팁
      if (r.genre) b.title = `${r.genre}${r.note ? ` · ${r.note}` : ''}`;
      b.style.borderLeftColor = color;
      if (picked[side].label === norm(r.label)) b.classList.add('on');
      b.addEventListener('click', () => {
        picked[side] = { label: norm(r.label), mods: [] };
        autoFillOther(norm(r.label));
        // 그룹 계열은 v1 에 표현할 자리가 없다 — 고르면 알린다(§5)
        hint.textContent = r.groupOnly
          ? `'${r.label}' 은 v1 에서는 선이 아니라 소속 색으로 대신 나타납니다.`
          : (r.note ?? '');
        syncMods();
        renderPreview();
        renderList();
      });
      return b;
    }

    /**
     * **층위1만 펼쳐 보인다**(§5·§7).
     * 계열 하나 안에서도 층위가 섞여 있으므로, 계열을 열되 그 안에서 다시
     * 「층위2·3」을 접어둔다. 이렇게 안 하면 `직장·조직` 하나가 52개로 쏟아진다.
     * **접힌 것도 검색에는 걸린다** — 안 그러면 접기가 곧 숨기기가 된다.
     */
    function renderList() {
      const q = norm(search.value);
      list.textContent = '';
      hint.textContent = '';
      let shown = 0;

      for (const g of groups) {
        const hits = g.items.filter((r) => matches(r, q));
        if (!hits.length) continue;
        const open1 = hits.filter((r) => r.tier === OPEN_TIER);
        const rest = hits.filter((r) => r.tier !== OPEN_TIER);
        shown += hits.length;

        const det = el('details', 'role-group');
        det.open = q !== '' || open1.length > 0;

        const sum = el('summary');
        const dot = el('span', 'cat-dot');
        dot.style.background = g.category.color;
        const count = open1.length
          ? `${open1.length}${rest.length ? ` (+${rest.length})` : ''}`
          : `+${rest.length}`;
        sum.append(dot, document.createTextNode(`${g.category.label} ${count}`));
        det.appendChild(sum);

        if (open1.length) {
          const box = el('div', 'role-items');
          for (const r of open1) box.appendChild(roleButton(r, g.category.color));
          det.appendChild(box);
        }

        if (rest.length) {
          const sub = el('details', 'role-sub');
          sub.open = q !== '';                             // 검색 중에는 펼쳐서 보여준다
          const ss = el('summary', '', `층위2·3 ${rest.length}개`);
          sub.appendChild(ss);
          const box = el('div', 'role-items');
          for (const r of rest) box.appendChild(roleButton(r, g.category.color));
          sub.appendChild(box);
          det.appendChild(sub);
        }

        list.appendChild(det);
      }

      if (!shown) {
        list.appendChild(el('div', 'role-none', `'${search.value}' 에 걸리는 관계명이 없습니다.`));
      }
    }
  });
}

// ─────────────────────────────────────────── 도우미

function el(tag, cls = '', text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function matches(role, q) {
  if (role.hidden) return false;
  if (!q) return true;
  const hay = [role.label, ...(role.aliases ?? [])].map(norm);
  return hay.some((h) => h.includes(q));
}

/** `엄마(의붓)` → { label: '엄마', mods: ['의붓'] } */
function parseInitial(text) {
  const t = norm(text ?? '');
  if (!t) return { label: null, mods: [] };
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(t);
  if (!m) return { label: t, mods: [] };
  return { label: norm(m[1]), mods: m[2].split(',').map(norm).filter(Boolean) };
}

function compose(p) {
  if (!p?.label) return '';
  return p.mods.length ? `${p.label}(${p.mods.join(', ')})` : p.label;
}

/** 그 인물이 이미 쓰고 있는 관계명들 — 역방향 제안의 단서(§12). */
function rolesUsedBy(id) {
  const out = [];
  const c = byId(id);
  if (!c) return out;
  for (const rel of adjacency().get(id)?.rels ?? []) {
    // 그 사람이 상대에게 무엇인가 = 그 사람 쪽 역할
    const mine = rel.idA === id ? rel.roleA : rel.roleB;
    if (mine && !mine.empty && mine.label) out.push(mine.label);
  }
  return out;
}

export { compose as composeRole, parseInitial as splitRole };
