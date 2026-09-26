"""Search-query variants built for partner web research."""
from app.ai.agents.partner_profile_researcher import MAX_QUERIES, build_queries, split_name


def texts(qs):
    return [q for q, _ in qs]


def test_split_full_name():
    assert split_name("Klaus Reither") == {"first": "Klaus", "last": "Reither", "initial": "K", "single": ""}


def test_split_initial_and_surname():
    assert split_name("A. Redfern") == {"first": "", "last": "Redfern", "initial": "A", "single": ""}


def test_split_keeps_surname_particles():
    parts = split_name("James van Duuren")
    assert parts["first"] == "James" and parts["last"] == "van Duuren"


def test_split_single_name():
    assert split_name("Djite")["single"] == "Djite"


def test_full_name_variants():
    qs = build_queries("klaus.reither@swisstph.ch", "Klaus Reither", False, "Swiss TPH", "swisstph.ch",
                       ["tuberculosis", "from:Swiss TPH", "consortium-2026"])
    t = texts(qs)
    assert t[0] == '"klaus.reither@swisstph.ch"'
    assert '"Klaus Reither" Swiss TPH' in t                      # first + last + institution
    assert ("Klaus Reither", {"include_domains": ["swisstph.ch"]}) in qs  # within their own site
    assert '"K. Reither" Swiss TPH' in t                          # first initial + last
    assert '"Reither" Swiss TPH' in t                             # institution + last
    assert any(kw.get("include_domains") == ["linkedin.com"] for _, kw in qs)
    assert '"Reither" tuberculosis' in t                          # last + research tag
    assert not any("consortium-2026" in x or "from:" in x for x in t)  # bookkeeping tags skipped
    assert len(qs) <= MAX_QUERIES


def test_initial_only_uses_surname_forms():
    t = texts(build_queries("redfern@sun.ac.za", "A Redfern", False, "", "sun.ac.za", ["pediatrics"]))
    assert "A Redfern" in t                  # searched within sun.ac.za
    assert '"A. Redfern" sun.ac.za' in t
    assert '"Redfern" sun.ac.za' in t
    assert '"Redfern" pediatrics' in t
    assert not any(x.startswith('"A Redfern"') for x in t)  # no fake "first name" query


def test_from_tag_stands_in_for_missing_institution():
    t = texts(build_queries("x@gmail.com", "Karim Manji", False, "", "", ["from:Muhimbili University"]))
    assert '"Karim Manji" Muhimbili University' in t


def test_single_name_at_institution_stays_on_their_site():
    qs = build_queries("mariekevdzalm@sun.ac.za", "Marie", True, "", "sun.ac.za", ["TB"])
    assert ("Marie", {"include_domains": ["sun.ac.za"]}) in qs
    assert "Marie sun.ac.za TB" in texts(qs)


def test_lone_first_name_at_gmail_only_searches_email():
    assert texts(build_queries("tafadzwalukwa@gmail.com", "Akim", True, "", "", [])) == ['"tafadzwalukwa@gmail.com"']


def test_guessed_names_are_not_phrase_quoted():
    t = texts(build_queries("abdallah.mwaduga@aol.com", "Abdallah Mwaduga", True, "", "", ["malaria"]))
    assert "Mwaduga malaria" in t and not any('"Abdallah Mwaduga"' in x for x in t)


def test_no_duplicates():
    qs = build_queries("a@b.org", "Jo Bloggs", False, "", "b.org", [])
    keys = [(" ".join(q.lower().split()), tuple(kw.get("include_domains") or [])) for q, kw in qs]
    assert len(keys) == len(set(keys))
