"""Gantt chart PDF export service.

Uses Playwright (headless Chromium) to render a self-contained HTML Gantt
template and export it as a PDF.  Playwright is already listed in
requirements.txt; run `playwright install chromium` once after deployment.
"""
from __future__ import annotations

from typing import Any

TYPE_COLORS: dict[str, str] = {
    "task": "#6366f1",
    "subtask": "#a5b4fc",
    "milestone": "#a855f7",
    "deadline": "#ef4444",
    "review_period": "#eab308",
    "partner_dependency": "#f97316",
    "institutional_approval": "#14b8a6",
    "submission_window": "#22c55e",
}


def _days_between(start: str, end: str) -> int:
    from datetime import date

    d1 = date.fromisoformat(start)
    d2 = date.fromisoformat(end)
    return max(1, (d2 - d1).days + 1)


def _build_html(grant_title: str, items: list[Any]) -> str:
    valid = [i for i in items if i.start_date and i.end_date]
    if not valid:
        return (
            "<html><body style='font-family:sans-serif;padding:24px'>"
            "<p>No Gantt items with dates.</p></body></html>"
        )

    all_dates = [str(i.start_date) for i in valid] + [str(i.end_date) for i in valid]
    min_date = min(all_dates)
    max_date = max(all_dates)
    total_days = _days_between(min_date, max_date)

    def pct_left(d: str) -> float:
        return (_days_between(min_date, d) - 1) / total_days * 100

    def pct_width(s: str, e: str) -> float:
        return max(0.5, _days_between(s, e) / total_days * 100)

    rows_html = ""
    for item in valid:
        color = TYPE_COLORS.get(item.item_type, "#6b7280")
        left = pct_left(str(item.start_date))
        width = pct_width(str(item.start_date), str(item.end_date))
        rows_html += f"""
      <tr>
        <td class="name">{item.title}</td>
        <td class="bar-cell">
          <div class="bar-track">
            <div class="bar" style="left:{left:.2f}%;width:{width:.2f}%;background:{color}"></div>
          </div>
        </td>
        <td class="date">{item.end_date}</td>
      </tr>"""

    # Build colour legend
    legend_html = "".join(
        f'<span class="leg-item"><span class="leg-dot" style="background:{color}"></span>'
        f'{t.replace("_"," ")}</span>'
        for t, color in TYPE_COLORS.items()
    )

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           padding: 20px 24px; color: #111827; }}
    h1  {{ font-size: 15px; font-weight: 600; margin-bottom: 2px; }}
    .sub {{ font-size: 10px; color: #6b7280; margin-bottom: 12px; }}
    table {{ width: 100%; border-collapse: collapse; }}
    thead tr {{ border-bottom: 1.5px solid #e5e7eb; }}
    th  {{ font-size: 9px; font-weight: 600; color: #6b7280; text-transform: uppercase;
           letter-spacing: .06em; padding: 4px 6px; text-align: left; }}
    td  {{ padding: 3px 6px; }}
    .name {{ font-size: 10px; white-space: nowrap; overflow: hidden;
             text-overflow: ellipsis; max-width: 160px; color: #374151; }}
    .bar-cell {{ width: 100%; }}
    .bar-track {{ position: relative; height: 14px; background: #f9fafb;
                  border-radius: 3px; overflow: hidden; }}
    .bar {{ position: absolute; top: 0; height: 100%; border-radius: 3px; opacity: .85; }}
    .date {{ font-size: 9px; color: #9ca3af; white-space: nowrap; text-align: right; }}
    tbody tr:nth-child(even) {{ background: #f9fafb; }}
    .legend {{ margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }}
    .leg-item {{ font-size: 9px; color: #6b7280; display: flex; align-items: center; gap: 4px; }}
    .leg-dot  {{ width: 10px; height: 10px; border-radius: 2px; display: inline-block; }}
  </style>
</head>
<body>
  <h1>{grant_title} — Gantt Chart</h1>
  <p class="sub">{min_date} → {max_date} &nbsp;·&nbsp; {len(valid)} items</p>
  <table>
    <thead>
      <tr>
        <th style="width:160px">Task / Item</th>
        <th>Timeline ({min_date} to {max_date})</th>
        <th style="width:72px;text-align:right">End</th>
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
  </table>
  <div class="legend">{legend_html}</div>
</body>
</html>"""


async def generate_gantt_pdf(grant_title: str, items: list[Any]) -> bytes:
    """Render the Gantt chart as a landscape A4 PDF using Playwright."""
    from playwright.async_api import async_playwright

    html = _build_html(grant_title, items)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.set_content(html, wait_until="networkidle")
        pdf_bytes = await page.pdf(
            format="A4",
            landscape=True,
            margin={"top": "12mm", "bottom": "12mm", "left": "12mm", "right": "12mm"},
            print_background=True,
        )
        await browser.close()
    return pdf_bytes
