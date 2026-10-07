#!/usr/bin/env python3
"""Widen the boot sun orbit, use many small dots, whip-fast on the downward half."""
from pathlib import Path
import re

DOT_N = 24
RADIUS = 112
WRAP = 248
DOT = 5
HALF = DOT / 2
WEATHER = 96


def nth_rules(important=False):
    bang = " !important" if important else ""
    lines = []
    for i in range(DOT_N):
        ang = i * (360 / DOT_N)
        op = 1.0 - i * (0.92 / (DOT_N - 1))
        lines.append(
            f".login-gate-boot-orbit-dots i:nth-child({i + 1}) {{"
            f" transform: rotate({ang:.1f}deg) translate({RADIUS}px){bang};"
            f" opacity: {op:.3f}{bang}; }}"
        )
    return "\n".join(lines)


CRITICAL_ORBIT = f'''  .login-gate-boot-orbit-wrap {{
    position: relative !important;
    width: {WRAP}px !important;
    height: {WRAP}px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }}
  .login-gate-boot-weather {{
    position: relative !important;
    width: {WEATHER}px !important;
    height: {WEATHER}px !important;
    z-index: 1 !important;
  }}
  .login-gate-boot-orbit-ring {{
    display: none !important;
  }}
  .login-gate-boot-orbit-dots {{
    position: absolute !important;
    inset: 0 !important;
    animation: criticalBootSpin 1.28s linear infinite !important;
  }}
  .login-gate-boot-orbit-dots i {{
    position: absolute !important;
    top: 50% !important;
    left: 50% !important;
    width: {DOT}px !important;
    height: {DOT}px !important;
    margin: -{HALF}px 0 0 -{HALF}px !important;
    border-radius: 50% !important;
    background: #ffffff !important;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.7) !important;
  }}
{chr(10).join("  " + ln for ln in nth_rules(True).splitlines())}
  @keyframes criticalBootSpin {{
    0% {{ transform: rotate(0deg); }}
    14% {{ transform: rotate(180deg); }}
    100% {{ transform: rotate(360deg); }}
  }}
  @media (prefers-reduced-motion: reduce) {{
    .login-gate-boot-orbit-dots {{ animation: none !important; }}
  }}'''

CSS_ORBIT = f'''/* BOOT_ORBIT_DOTS_V2 */
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
  animation: login-boot-orbit-whip 1.28s linear infinite;
  pointer-events: none;
}}
.login-gate-boot-orbit-dots i {{
  position: absolute;
  top: 50%;
  left: 50%;
  width: {DOT}px;
  height: {DOT}px;
  margin: -{HALF}px 0 0 -{HALF}px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.7);
}}
{nth_rules(False)}
.login-gate-boot-orbit-wrap .login-gate-boot-weather {{
  width: {WEATHER}px;
  height: {WEATHER}px;
  z-index: 1;
}}
@keyframes login-boot-orbit-whip {{
  0% {{ transform: rotate(0deg); }}
  14% {{ transform: rotate(180deg); }}
  100% {{ transform: rotate(360deg); }}
}}
@media (prefers-reduced-motion: reduce) {{
  .login-gate-boot-orbit-dots {{ animation: none; }}
}}
'''


def patch_html(html: str) -> str:
    pat_crit = re.compile(
        r"  \\.login-gate-boot-orbit-wrap \\{[\\s\\S]*?@media \\(prefers-reduced-motion: reduce\\) \\{\\s*\\n    \\.login-gate-boot-orbit-dots \\{ animation: none !important; \\}\\s*\\n  \\}",
        re.M,
    )
    html2, n = pat_crit.subn(CRITICAL_ORBIT, html, count=1)
    if n != 1:
        raise SystemExit(f"critical orbit css not found n={n}")
    html = html2
    dots_html = "<i></i>" * DOT_N
    html2, n = re.subn(
        r'<span class="login-gate-boot-orbit-dots" aria-hidden="true">(?:<i></i>)+</span>',
        f'<span class="login-gate-boot-orbit-dots" aria-hidden="true">{dots_html}</span>',
        html,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"orbit dots html not found n={n}")
    return html2


def patch_css(css: str) -> str:
    if "/* BOOT_ORBIT_DOTS_V2 */" in css:
        pat = re.compile(
            r"/\\* BOOT_ORBIT_DOTS_V2 \\*/[\\s\\S]*?@media \\(prefers-reduced-motion: reduce\\) \\{\\s*\\n  \\.login-gate-boot-orbit-dots \\{ animation: none; \\}\\s*\\n\\}",
            re.M,
        )
        css2, n = pat.subn(CSS_ORBIT.rstrip(), css, count=1)
        if n != 1:
            raise SystemExit("BOOT_ORBIT_DOTS_V2 block replace failed")
        return css2
    pat = re.compile(
        r"\\.login-gate-boot-orbit-wrap \\{[\\s\\S]*?@media \\(prefers-reduced-motion: reduce\\) \\{\\s*\\n  \\.login-gate-boot-orbit-dots \\{ animation: none; \\}\\s*\\n\\}",
        re.M,
    )
    css2, n = pat.subn(CSS_ORBIT.rstrip(), css, count=1)
    if n != 1:
        raise SystemExit(f"style.css orbit block not found n={n}")
    return css2


def main():
    html_path = Path("public/index.html")
    css_path = Path("public/style.css")
    html_path.write_text(patch_html(html_path.read_text(encoding="utf-8")), encoding="utf-8")
    print("html ok")
    css_path.write_text(patch_css(css_path.read_text(encoding="utf-8")), encoding="utf-8")
    print("css ok")


if __name__ == "__main__":
    main()
