# Scraping pipeline — operations notes

## How it works

Three complementary ingestion paths, all funneling into the same dedup →
surface → enrich → tag → score chain (so org + personal keyword ranking and the
taste profile apply uniformly):

1. **Portal scraping** — `scan_all_sources` (weekly) + `scan_high_priority_sources`
   (daily) iterate `sources` and run the matching scraper. Dedicated API scrapers
   for structured sources (grants.gov, NSF, NIH RePORTER, UKRI GtR, OpenAlex,
   ProPublica, SBIR, EU F&T, **OpenReview** for AI/ML conference & workshop
   calls-for-papers); the generic `AIScraper` (gpt-4o-mini) for everything
   else — it fetches listing pages, paginates, follows detail links, and now
   escalates to a headless browser automatically when a page looks blocked or
   JS-rendered (`app/scrapers/fetch.py`).
2. **Portal discovery** — `discover_new_sources` uses web search (Exa if
   `EXA_API_KEY`, else Tavily via `TAVILY_API_KEY`) to find new funder portals,
   LLM-classifies them, and adds high-confidence ones as sources.
3. **Direct opportunity search** — `search_opportunities_all` (weekly) searches
   the web per-institution for one-off grants/fellowships/conferences/workshops
   that have no scrapeable portal, classifies each hit, and inserts specific
   opportunities directly.

## The audit harness

`python scripts/audit_sources.py` stress-tests every source and explains why any
return zero. It needs no database.

- `--fix` applies safe repairs to `data/grant_funding_portals.json`: dead listing
  paths whose site root is still alive get repointed to the root with a
  funding-focused `link_filter`; genuinely dead hosts get paused; JS-only pages
  get `use_playwright: true`.
- `--llm N` additionally runs full LLM extraction on N sampled sources to measure
  real yield (needs `OPENAI_API_KEY`).
- Output: `data/source_audit_report.json`.

Last audit (2026-07-22): of 320 active sources, 174 fetched clean; 99 auto-repaired
(75 dead paths repointed to live roots + link_filter, plus targeted pauses); the
dedicated API scrapers for grants.gov, SBIR, OpenAlex, and ProPublica were fixed
after their upstream APIs changed.

## Optional API keys (set as env vars; all degrade gracefully if absent)

| Var | Effect if set |
|-----|---------------|
| `TAVILY_API_KEY` | Enables web-based source discovery + direct opportunity search (already configured). |
| `EXA_API_KEY` | Preferred over Tavily for discovery (adds neural find-similar peer discovery). Read automatically from the environment via `Settings(BaseSettings)` — just set it on the Railway backend service. |
| `GRANTS_GOV_SIMPLER_API_KEY` | Uses the richer Simpler Grants API for grants.gov; without it we use the keyless Search2 API (works fine). |
| `IATI_API_KEY` | Re-enables the IATI Datastore scraper (free key from https://developer.iatistandard.org/). The IATI source is paused until this is set. |

## Known upstream limitations

- **SBIR.gov** rate-limits aggressively (HTTP 429); the scraper retries with
  backoff but may still come back empty during busy periods — it self-recovers.
- **360Giving GrantNav** retired its public API; that source is paused pending a
  new integration via 360Giving's bulk data downloads.

## Conference / scholarship / fellowship coverage

Beyond OpenReview (AI/ML only), the seed now includes ~21 cross-discipline
**conference** aggregators (WikiCFP, EasyChair CFP, Conference Index, 10times,
Clocate, Nature Conferences, eMedEvents, ACM, Elsevier events, etc.) and ~16
**scholarship/fellowship** aggregators (Scholars4Dev, ProFellow, Scholarships.com,
Fastweb, IEFA, Fulbright US Student & Scholar programs, OpportunityDesk,
GoAbroad, CFR fellowships, etc.), all `ai_scraper` type with a `link_filter`
tuned to their listing structure. Sources that 403 or render via JS are flagged
`use_playwright: true`; the shared fetch layer also auto-escalates. Added &
audit-verified 2026-07-22 (sample extraction confirmed: Scholars4Dev → 60
scholarships, ProFellow → 62 fellowships, WikiCFP → CFPs).

These aggregators are intentionally broad; the org + personal keyword scorer and
the taste profile rank each org's feed, and ingestion-time dedup collapses
week-over-week repeats.

## OpenReview conference/workshop source

`app/scrapers/openreview_scraper.py` (source_type `openreview`) reads the
OpenReview API v2 (`https://api2.openreview.net`, no auth for public reads):
lists `active_venues`, keeps recent Conference/Workshop/Symposium venues, batch-
fetches each venue's metadata, and parses the submission deadline out of the
freeform `date` field. Config knobs: `year_min` (floor year, default current
year), `max_venues` (cap, default 150), `require_deadline` (default true — drops
venues whose deadline is TBD/unparseable). Produces `conference`/`workshop`
opportunity types.
