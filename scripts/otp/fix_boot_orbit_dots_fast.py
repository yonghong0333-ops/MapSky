#!/usr/bin/env python3
"""Sparse orbit: a few dots, fuse into a line at the top, then scatter into many."""
from pathlib import Path
import math

RADIUS = 112
WRAP = 248
WEATHER = 96
C = 2 * math.pi * RADIUS
DURATION = "2.6s"


def pairs_str(pairs):
    return " ".join(f"{a:.3f} {b:.3f}" for a, b in pairs)


def few_pairs():
    """6 distinct dots around the circle (18 dash pairs)."""
    dash, slot = 11.0, C / 18
    g1 = C / 6 - dash - 2 * slot
    out = []
    for _ in range(6):
        out += [(dash, g1), (0.0, slot), (0.0, slot)]
    return out


def gather_pairs():
    """6 dots bunched near the head, about to become a line."""
    dash, gap = 12.0, 9.0
    used = 6 * (dash + gap)
    empty = (C - used) / 12
    return [(dash, gap)] * 6 + [(0.0, empty)] * 12


def line_pairs():
    """Solid-looking arc (round caps close the 4.5px gaps)."""
    dash, gap, n = 22.0, 4.5, 7
    empty = (C - n * (dash + gap)) / 11
    return [(dash, gap)] * n + [(0.0, empty)] * 11


def split_pairs():
    """Line breaking into a short dotted run."""
    dash, gap, n = 8.0, 7.0, 12
    empty = (C - n * (dash + gap)) / 6
    return [(dash, gap)] * n + [(0.0, empty)] * 6


def many_pairs():
    """18 small dots around the full ring."""
    dash = 5.5
    gap = C / 18 - dash
    return [(dash, gap)] * 18


FEW = pairs_str(few_pairs())
GATHER = pairs_str(gather_pairs())
LINE = pairs_str(line_pairs())
SPLIT = pairs_str(split_pairs())
MANY = pairs_str(many_pairs())

ORBIT_SVG = (
    f'<span class="login-gate-boot-orbit-dots" aria-hidden="true">'
    f'<svg viewBox="0 0 {WRAP} {WRAP}" width="{WRAP}" height="{WRAP}">'
    f'<circle cx="{WRAP // 2}" cy="{WRAP // 2}" r="{RADIUS}" /></svg></span>'
)

MORPH_KEYFRAMES = f"""    0%   {{ stroke-dasharray: {LINE}; }}
    14%  {{ stroke-dasharray: {SPLIT}; }}
    32%  {{ stroke-dasharray: {MANY}; }}
    58%  {{ stroke-dasharray: {FEW}; }}
    84%  {{ stroke-dasharray: {GATHER}; }}
    100% {{ stroke-dasharray: {LINE}; }}"""


def orbit_css(important=False):
    bang = " !important" if important else ""
    pfx = "  " if important else ""
    kf_spin = "criticalBootSpin" if important else "login-boot-orbit-spin"
    kf_morph = "criticalBootMorph" if important else "login-boot-orbit-morph"
    return f"""{pfx}.login-gate-boot-orbit-wrap {{
{pfx}  position: relative{" !important" if important else ""};
{pfx}  width: {WRAP}px{" !important" if important else ""};
{pfx}  height: {WRAP}px{" !important" if important else ""};
{pfx}  display: flex{" !important" if important else ""};
{pfx}  align-items: center{" !important" if important else ""};
{pfx}  justify-content: center{" !important" if important else ""};
{pfx}}}
{pfx}.login-gate-boot-weather {{
{pfx}  position: relative{" !important" if important else ""};
{pfx}  width: {WEATHER}px{" !important" if important else ""};
{pfx}  height: {WEATHER}px{" !important" if important else ""};
{pfx}  z-index: 1{" !important" if important else ""};
{pfx}}}
{pfx}.login-gate-boot-orbit-ring {{
{pfx}  display: none{" !important" if important else ""};
{pfx}}}
{pfx}.login-gate-boot-orbit-dots {{
{pfx}  position: absolute{" !important" if important else ""};
{pfx}  inset: 0{" !important" if important else ""};
{pfx}  pointer-events: none{" !important" if important else ""};
{pfx}}}
{pfx}.login-gate-boot-orbit-dots svg {{
{pfx}  width: {WRAP}px{" !important" if important else ""};
{pfx}  height: {WRAP}px{" !important" if important else ""};
{pfx}  overflow: visible{" !important" if important else ""};
{pfx}  transform-origin: 50% 50%{" !important" if important else ""};
{pfx}  animation: {kf_spin} {DURATION} linear infinite{" !important" if important else ""};
{pfx}}}
{pfx}.login-gate-boot-orbit-dots circle {{
{pfx}  fill: none{" !important" if important else ""};
{pfx}  stroke: #ffffff{" !important" if important else ""};
{pfx}  stroke-width: 6{" !important" if important else ""};
{pfx}  stroke-linecap: round{" !important" if important else ""};
{pfx}  filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.7)){" !important" if important else ""};
{pfx}  animation: {kf_morph} {DURATION} linear infinite{" !important" if important else ""};
{pfx}}}
{pfx}@keyframes {kf_spin} {{
{pfx}  from {{ transform: rotate(-90deg); }}
{pfx}  to {{ transform: rotate(270deg); }}
{pfx}}}
{pfx}@keyframes {kf_morph} {{
{MORPH_KEYFRAMES}
{pfx}}}
{pfx}@media (prefers-reduced-motion: reduce) {{
{pfx}  .login-gate-boot-orbit-dots svg,
{pfx}  .login-gate-boot-orbit-dots circle {{ animation: none{" !important" if important else ""}; }}
{pfx}}}"""


CRITICAL_ORBIT = orbit_css(True)

CSS_ORBIT = f"""/* BOOT_ORBIT_DOTS_V3 */
.login-gate-boot-orbit-wrap {{
  position: relative;
  width: {WRAP}px;
  height: {WRAP}px;
  display: flex;
  align-items: center;
  justify-content: center;
}}
.login-gate-boot-orbit-ring {{
  display: none;
}}
.login-gate-boot-orbit-dots {{
  position: absolute;
  inset: 0;
  pointer-events: none;
}}
.login-gate-boot-orbit-dots svg {{
  width: {WRAP}px;
  height: {WRAP}px;
  overflow: visible;
  transform-origin: 50% 50%;
  animation: login-boot-orbit-spin {DURATION} linear infinite;
}}
.login-gate-boot-orbit-dots circle {{
  fill: none;
  stroke: #ffffff;
  stroke-width: 6;
  stroke-linecap: round;
  filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.7));
  animation: login-boot-orbit-morph {DURATION} linear infinite;
}}
.login-gate-boot-orbit-wrap .login-gate-boot-weather {{
  width: {WEATHER}px;
  height: {WEATHER}px;
  z-index: 1;
}}
@keyframes login-boot-orbit-spin {{
  from {{ transform: rotate(-90deg); }}
  to {{ transform: rotate(270deg); }}
}}
@keyframes login-boot-orbit-morph {{
    0%   {{ stroke-dasharray: {LINE}; }}
    14%  {{ stroke-dasharray: {SPLIT}; }}
    32%  {{ stroke-dasharray: {MANY}; }}
    58%  {{ stroke-dasharray: {FEW}; }}
    84%  {{ stroke-dasharray: {GATHER}; }}
    100% {{ stroke-dasharray: {LINE}; }}
}}
@media (prefers-reduced-motion: reduce) {{
  .login-gate-boot-orbit-dots svg,
  .login-gate-boot-orbit-dots circle {{ animation: none; }}
}}"""


def replace_once(src, start_token, end_token, replacement, label):
    start = src.find(start_token)
    if start < 0:
        raise SystemExit(f"{label}: start not found")
    end = src.find(end_token, start)
    if end < 0:
        raise SystemExit(f"{label}: end not found")
    end += len(end_token)
    return src[:start] + replacement + src[end:]


def patch_html(html):
    html = replace_once(
        html,
        "  .login-gate-boot-orbit-wrap {",
        "    .login-gate-boot-orbit-dots { animation: none !important; }\n  }",
        CRITICAL_ORBIT,
        "critical css",
    )
    start = html.find('<span class="login-gate-boot-orbit-dots" aria-hidden="true">')
    if start < 0:
        raise SystemExit("orbit dots html not found")
    end = html.find("</span>", start)
    if end < 0:
        raise SystemExit("orbit dots html close not found")
    end += len("</span>")
    return html[:start] + ORBIT_SVG + html[end:]


def patch_css(css):
    if "/* BOOT_ORBIT_DOTS_V3 */" in css:
        return replace_once(
            css,
            "/* BOOT_ORBIT_DOTS_V3 */",
            ".login-gate-boot-orbit-dots circle { animation: none; }\n}",
            CSS_ORBIT,
            "css v3",
        )
    if "/* BOOT_ORBIT_DOTS_V2 */" in css:
        return replace_once(
            css,
            "/* BOOT_ORBIT_DOTS_V2 */",
            ".login-gate-boot-orbit-dots { animation: none; }\n}",
            CSS_ORBIT,
            "css v2",
        )
    return replace_once(
        css,
        ".login-gate-boot-orbit-wrap {",
        ".login-gate-boot-orbit-dots { animation: none; }\n}",
        CSS_ORBIT,
        "css orbit",
    )


def main():
    html_path = Path("public/index.html")
    css_path = Path("public/style.css")
    html_path.write_text(patch_html(html_path.read_text(encoding="utf-8")), encoding="utf-8")
    print("html ok")
    css_path.write_text(patch_css(css_path.read_text(encoding="utf-8")), encoding="utf-8")
    print("css ok")


if __name__ == "__main__":
    main()
