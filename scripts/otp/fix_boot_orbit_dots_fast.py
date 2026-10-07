#!/usr/bin/env python3
"""Widen the boot sun orbit, use many small dots, whip-fast on the downward half."""
from pathlib import Path

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
        prefix = "  " if important else ""
        lines.append(
            f"{prefix}.login-gate-boot-orbit-dots i:nth-child({i + 1}) {{"
            f" transform: rotate({ang:.1f}deg) translate({RADIUS}px){bang};"
            f" opacity: {op:.3f}{bang}; }}"
        )
    return "\n".join(lines)


CRITICAL_ORBIT = f"""  .login-gate-boot-orbit-wrap {{
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
{nth_rules(True)}
  @keyframes criticalBootSpin {{
    0% {{ transform: rotate(0deg); }}
    14% {{ transform: rotate(180deg); }}
    100% {{ transform: rotate(360deg); }}
  }}
  @media (prefers-reduced-motion: reduce) {{
    .login-gate-boot-orbit-dots {{ animation: none !important; }}
  }}"""

CSS_ORBIT = f"""/* BOOT_ORBIT_DOTS_V2 */
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
    dots = "<i></i>" * DOT_N
    new = f'<span class="login-gate-boot-orbit-dots" aria-hidden="true">{dots}</span>'
    return html[:start] + new + html[end:]


def patch_css(css):
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
