#!/usr/bin/env python
"""버전 값을 저장소 전체에서 한 번에 올린다.

    python bump.py 20260727a
    python bump.py            # 오늘 날짜 + 다음 글자로 알아서 정한다

ES 모듈은 import 로 이어진 파일이 각각 따로 캐시된다. index.html 이 새로 와도
src/*.js 는 옛것이 온다. 아이패드 사파리에는 강력 새로고침이 없다.
그래서 버전 문자열을 주소에 실어 보내고(?v=...), **배포 전에 이 값을 바꾸는 것이
배포 절차의 일부다**(계획서 §3).

값이 여러 파일에 흩어져 있어 손으로 하면 반드시 하나를 빠뜨린다.
node 가 없어도 돌아야 하므로 python 으로 쓴다.
"""

import re
import sys
import datetime
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
VERSION_FILE = ROOT / "src" / "version.js"

# ?v= 를 실어 나르는 파일들. tests/ 는 캐시를 안 타므로 뺀다.
TARGETS = ["index.html", "src/*.js"]
# sw.js 는 `?v=` 를 안 쓴다 — 버전을 **등록 주소에서 읽는다**(main.js 의 register 한 줄).
# 그 한 줄이 src/main.js 안에 있으므로 위 목록으로 이미 덮인다.

QUERY_RE = re.compile(r"(\?v=)([0-9a-zA-Z._-]+)")
CONST_RE = re.compile(r"(export const VERSION = ')([^']*)(';)")


def current() -> str:
    m = CONST_RE.search(VERSION_FILE.read_text(encoding="utf-8"))
    if not m:
        sys.exit(f"!! {VERSION_FILE} 에서 VERSION 상수를 못 찾았습니다")
    return m.group(2)


def suggest(cur: str) -> str:
    """오늘 날짜 + a, b, c…  같은 날 두 번째 배포면 글자만 올린다."""
    today = datetime.date.today().strftime("%Y%m%d")
    if cur.startswith(today) and len(cur) == len(today) + 1:
        nxt = chr(ord(cur[-1]) + 1)
        if nxt <= "z":
            return today + nxt
    return today + "a"


def files():
    seen = []
    for pat in TARGETS:
        for p in sorted(ROOT.glob(pat)):
            if p.is_file() and p not in seen:
                seen.append(p)
    return seen


def main() -> int:
    cur = current()

    if len(sys.argv) > 2:
        sys.exit("사용법: python bump.py [새버전]")
    new = sys.argv[1] if len(sys.argv) == 2 else suggest(cur)

    if not re.fullmatch(r"[0-9a-zA-Z._-]+", new):
        sys.exit(f"!! 주소에 실을 수 없는 값입니다: {new!r}")
    if new == cur:
        sys.exit(f"!! 지금 값과 같습니다: {cur}. 값을 안 바꾸면 캐시가 안 뚫립니다")

    total = 0
    touched = []
    for p in files():
        text = p.read_text(encoding="utf-8")
        out, n = QUERY_RE.subn(lambda m: m.group(1) + new, text)
        if p == VERSION_FILE:
            out, c = CONST_RE.subn(lambda m: m.group(1) + new + m.group(3), out)
            n += c
        if n:
            # newline="" 이 없으면 윈도우에서 \n 이 \r\n 으로 바뀌어
            # **고치지도 않은 줄까지 전부 바뀐 것처럼** 보인다. 버전 한 글자 올렸는데
            # 32군데가 아니라 파일 전체가 diff 에 뜬다.
            p.write_text(out, encoding="utf-8", newline="")
            touched.append((p.relative_to(ROOT).as_posix(), n))
            total += n

    for name, n in touched:
        print(f"  {name}  ({n})")
    print(f"\n{cur} → {new}   {total}군데 / 파일 {len(touched)}개")

    if total == 0:
        print("\n!! 한 군데도 안 바뀌었습니다. ?v= 를 안 쓰고 있는지 확인하세요")
        return 1

    print("\n다음: git add -A && git ls-files 를 통째로 훑고 커밋 → push")
    print("아이패드에서 오른쪽 아래 표시가 바뀌는지 확인하면 캐시가 뚫린 것입니다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
