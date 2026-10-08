#!/usr/bin/env python3
from pathlib import Path

JS = Path("public/renderer.js")

OLD = '''  el("currentTemp").textContent = `${minNow}–${maxNow}°C`;
  el("currentDesc").textContent = wxNow;
  el("currentDetail").textContent =
    `舒適度 ${ciNow}\n降雨機率 ${popNow}%\n資料來源：中央氣象署`;'''

NEW = '''  // 主溫度用單一數字（取該時段高溫）；低–高範圍改寫在舒適度下方
  el("currentTemp").textContent = `${maxNow}°C`;
  el("currentDesc").textContent = wxNow;
  el("currentDetail").textContent =
    `舒適度 ${ciNow}\n溫度 ${minNow}–${maxNow}°C\n資料來源：中央氣象署`;'''


def main():
    js = JS.read_text(encoding="utf-8")
    if "溫度 ${minNow}–${maxNow}°C" in js or "溫度 ${minNow}-${maxNow}°C" in js:
        print("already")
        return
    if OLD not in js:
        raise SystemExit("block not found")
    JS.write_text(js.replace(OLD, NEW, 1), encoding="utf-8")
    print("patched")


if __name__ == "__main__":
    main()
