"""AI services for grant financial management."""
from __future__ import annotations

import json
from typing import Any

from app.ai.client import chat_complete


async def analyze_variance(
    grant_title: str,
    categories_summary: list[dict[str, Any]],
    currency: str,
) -> dict[str, Any]:
    """Explain budget vs actual variance per category."""
    system = (
        "You are a nonprofit grant finance analyst. "
        "Analyze budget vs actual data and return JSON: "
        '{"summary": "<2-3 sentences>", "categories": [{"name": "...", "insight": "...", "risk": "low|medium|high"}], '
        '"recommendations": ["..."]}. Be concise and actionable.'
    )
    user = f"Grant: {grant_title}\nCurrency: {currency}\nCategory data:\n{json.dumps(categories_summary, indent=2)}"
    raw = await chat_complete(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        agent_name="finance_variance",
        json_mode=True,
        temperature=0.2,
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"summary": raw, "categories": [], "recommendations": []}


async def forecast_burn_rate(
    grant_title: str,
    total_awarded: float | None,
    currency: str,
    start_date: str | None,
    end_date: str | None,
    monthly_spend: list[dict[str, Any]],
    categories_summary: list[dict[str, Any]],
) -> dict[str, Any]:
    """12-month burn rate projection with optional what-if."""
    system = (
        "You are a grant financial forecaster. Return JSON: "
        '{"months": [{"month": "YYYY-MM", "projected_spend": number, "cumulative": number}], '
        '"runway_months": number|null, "summary": string, "alerts": [string]}. '
        "Use historical monthly_spend if provided; otherwise estimate from category balances."
    )
    user = json.dumps({
        "grant": grant_title,
        "total_awarded": total_awarded,
        "currency": currency,
        "start_date": start_date,
        "end_date": end_date,
        "monthly_spend": monthly_spend,
        "categories": categories_summary,
    })
    raw = await chat_complete(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        agent_name="finance_forecast",
        json_mode=True,
        temperature=0.2,
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"months": [], "runway_months": None, "summary": raw, "alerts": []}


async def categorize_fund_request(
    title: str,
    description: str | None,
    vendor: str | None,
    amount: float,
    categories: list[dict[str, str]],
) -> dict[str, Any]:
    """Suggest budget category and compliance notes for a fund request."""
    system = (
        "You are a grant budget categorization assistant. Return JSON: "
        '{"category_id": "<id or null>", "category_name": string, "confidence": "high|medium|low", '
        '"compliance_notes": string, "warnings": [string]}. '
        "Pick the best matching category_id from the provided list."
    )
    user = json.dumps({
        "title": title,
        "description": description,
        "vendor": vendor,
        "amount": amount,
        "categories": categories,
    })
    raw = await chat_complete(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        agent_name="finance_categorize",
        json_mode=True,
        temperature=0,
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"category_id": None, "category_name": None, "confidence": "low", "compliance_notes": raw, "warnings": []}


async def check_request_compliance(
    grant_title: str,
    funder: str | None,
    indirect_cost_rule: str | None,
    call_requirements: str | None,
    request: dict[str, Any],
    categories_summary: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate a fund request against grant restrictions before submission."""
    system = (
        "You are a grant compliance reviewer. Return JSON: "
        '{"approved": boolean, "score": 0-100, "issues": [{"severity": "error|warning|info", "message": string}], '
        '"suggestions": [string]}. '
        "Check allowable costs, category caps, and funder rules. temperature=0."
    )
    user = json.dumps({
        "grant": grant_title,
        "funder": funder,
        "indirect_cost_rule": indirect_cost_rule,
        "call_requirements": (call_requirements or "")[:3000],
        "request": request,
        "categories": categories_summary,
    })
    raw = await chat_complete(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        agent_name="finance_compliance",
        json_mode=True,
        temperature=0,
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"approved": False, "score": 0, "issues": [{"severity": "error", "message": raw}], "suggestions": []}
