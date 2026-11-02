"""Regenerate the GitHub entry point from the Apps Script UI and shared rules."""
from pathlib import Path
import base64
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parent
app_path = ROOT / 'apps-script' / 'App.html'
app = app_path.read_text()
if '/*__FONT__*/' in app:
    font_path = ROOT.parent / 'qa' / 'Pretendard-subset.woff2'
    font = base64.b64encode(font_path.read_bytes()).decode()
    app = app.replace('/*__FONT__*/', "@font-face{font-family:ScheduleSans;font-weight:100 900;font-style:normal;font-display:swap;src:url(data:font/woff2;base64," + font + ") format('woff2')}")
    app_path.write_text(app)
if '<!-- FONT-LICENSE' not in app:
    license_text = (ROOT / 'docs' / 'LICENSE-Pretendard.txt').read_text()
    app = app.replace('</head>', '<!-- FONT-LICENSE\nSchedule Sans is a subset of Pretendard. The modified font uses a different family name.\n' + license_text + '\n-->\n</head>')
    app_path.write_text(app)
core = (ROOT / 'apps-script' / 'Core.gs').read_text()
factory = core[core.index('function SwapCoreFactory_()'):].strip()
public = app.replace('/*__CORE_RUNTIME__*/', 'window.SwapCore = (' + factory + ')();')
public = public.replace('</head>', '<script src="config.js"></script>\n</head>')
(ROOT / 'github' / 'index.html').write_text(public)
scripts = re.findall(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>', public)
for script in scripts:
    if script.strip():
        subprocess.run(['node','--check','-'], input=script, text=True, check=True, capture_output=True)
print(json.dumps({'github_html_bytes':len(public.encode()),'app_html_bytes':len(app.encode()),'syntax':'OK'}))
