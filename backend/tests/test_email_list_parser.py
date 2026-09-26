"""Unit tests for parsing a pasted recipient list into contacts."""
from app.services.email_list_parser import parse_email_list


def _by_email(text):
    return {c.email: c for c in parse_email_list(text)}


def test_plain_name_and_address():
    c = _by_email("To: Lario Viljoen <lario@sun.ac.za>")["lario@sun.ac.za"]
    assert c.name == "Lario Viljoen"
    assert c.name_guessed is False
    assert c.personal_domain is False


def test_quoted_surname_first_with_honorific():
    c = _by_email('"Redfern, A, Dr" <redfern@sun.ac.za>')["redfern@sun.ac.za"]
    assert c.name == "A Redfern"


def test_parenthesised_address_in_display_name_is_dropped():
    c = _by_email('"Beth Amato (beth.amato3@wits.ac.za)" <beth.amato3@wits.ac.za>')["beth.amato3@wits.ac.za"]
    assert c.name == "Beth Amato"


def test_display_name_that_is_a_mangled_address_falls_back_to_local_part():
    c = _by_email('"enya. seguin@epfl. ch (enya.seguin@epfl.ch)" <enya.seguin@epfl.ch>')["enya.seguin@epfl.ch"]
    assert c.name == "Enya Seguin"
    assert c.name_guessed is True


def test_single_token_name_prefers_dotted_local_part():
    c = _by_email("abdallah <abdallah.mwaduga@aol.com>")["abdallah.mwaduga@aol.com"]
    assert c.name == "Abdallah Mwaduga"
    assert c.name_guessed is True
    assert c.personal_domain is True


def test_mailbox_name_is_flagged_and_capitalised():
    c = _by_email("hharmon <hharmon@butterflynetinc.com>")["hharmon@butterflynetinc.com"]
    assert c.name == "Hharmon"
    assert c.name_guessed is True


def test_shouted_surname_and_trailing_honorific():
    got = _by_email("Amadou Mansour DJITE <a@ucad.edu.sn>, Lamore Grayson Mnr <graysonl2@sun.ac.za>")
    assert got["a@ucad.edu.sn"].name == "Amadou Mansour Djite"
    assert got["graysonl2@sun.ac.za"].name == "Lamore Grayson"


def test_lowercase_names_capitalised_but_particles_kept():
    got = _by_email("verah luke <v@sun.ac.za>, James van Duuren <j@x.com>")
    assert got["v@sun.ac.za"].name == "Verah Luke"
    assert got["j@x.com"].name == "James van Duuren"


def test_bare_addresses_dedupe_and_keep_order():
    text = "x@one.org\nJane Roe <JANE@two.org>; x@one.org, y@three.org"
    assert [c.email for c in parse_email_list(text)] == ["x@one.org", "jane@two.org", "y@three.org"]


def test_address_inside_angle_pair_not_double_counted():
    assert len(parse_email_list('"a@b.org" <a@b.org>')) == 1


def test_empty():
    assert parse_email_list("") == []
    assert parse_email_list("no addresses here") == []


def test_clipped_header_label_is_not_part_of_the_name():
    got = _by_email("O: Lario Viljoen <lario@sun.ac.za>, Cc: Jane Roe <j@x.org>")
    assert got["lario@sun.ac.za"].name == "Lario Viljoen"
    assert got["j@x.org"].name == "Jane Roe"
