"""Budget spreadsheet parsing service.

Accepts an XLSX or CSV file and returns a list of budget line items,
auto-detecting common column names for description, category, quantity,
unit cost, and total.
"""
from __future__ import annotations

import io
from typing import Any

import pandas as pd


_DESCRIPTION_ALIASES = ["description", "item", "line item", "name", "cost item", "detail"]
_CATEGORY_ALIASES = ["category", "type", "cost type", "budget category", "section"]
_QUANTITY_ALIASES = ["quantity", "qty", "units", "count", "number", "no."]
_UNIT_COST_ALIASES = ["unit cost", "unit price", "rate", "price", "cost per unit", "unit rate"]
_TOTAL_ALIASES = ["total", "amount", "total cost", "subtotal", "total amount", "cost", "total usd", "total eur"]


def _find_col(columns: list[str], aliases: list[str]) -> str | None:
    lower_cols = [c.lower().strip() for c in columns]
    for alias in aliases:
        for i, col in enumerate(lower_cols):
            if alias in col:
                return columns[i]
    return None


def _to_float(raw: str | None) -> float | None:
    if not raw:
        return None
    cleaned = raw.replace(",", "").replace("$", "").replace("€", "").replace("£", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_budget_file(file_bytes: bytes, filename: str) -> list[dict[str, Any]]:
    """Parse an XLSX or CSV budget file and return structured line items.

    Returns a list of dicts with keys:
        description, category, quantity, unit_cost, total
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "xlsx"
    buf = io.BytesIO(file_bytes)

    try:
        if ext == "csv":
            df = pd.read_csv(buf, dtype=str)
        else:
            # Try to find the first sheet with data
            df = pd.read_excel(buf, dtype=str)
    except Exception as exc:
        raise ValueError(f"Could not read file '{filename}': {exc}") from exc

    # Drop fully empty rows / columns
    df = df.dropna(how="all").dropna(axis=1, how="all")
    df.columns = [str(c).strip() for c in df.columns]

    cols = df.columns.tolist()
    if not cols:
        return []

    desc_col = _find_col(cols, _DESCRIPTION_ALIASES)
    cat_col = _find_col(cols, _CATEGORY_ALIASES)
    qty_col = _find_col(cols, _QUANTITY_ALIASES)
    unit_cost_col = _find_col(cols, _UNIT_COST_ALIASES)
    total_col = _find_col(cols, _TOTAL_ALIASES)

    results: list[dict[str, Any]] = []
    for _, row in df.iterrows():

        def _str_val(col: str | None) -> str | None:
            if col is None:
                return None
            v = row.get(col)
            s = str(v).strip() if v is not None else ""
            return s if s and s.lower() not in ("nan", "none", "") else None

        description = _str_val(desc_col) or _str_val(cols[0])
        if not description:
            continue

        qty = _to_float(_str_val(qty_col))
        unit_cost = _to_float(_str_val(unit_cost_col))
        total = _to_float(_str_val(total_col))

        # Derive total from qty × unit_cost when not explicitly provided
        if total is None and qty is not None and unit_cost is not None:
            total = round(qty * unit_cost, 2)

        results.append(
            {
                "description": description,
                "category": _str_val(cat_col),
                "quantity": qty,
                "unit_cost": unit_cost,
                "total": total,
            }
        )

    return results
