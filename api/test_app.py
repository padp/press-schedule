"""Tests for app.py, run against mongomock - never touches real Mongo.

Seeded with data shaped like the real Press 1 Wednesday 1st shift file
(see CLAUDE.md), including the exact real-world entries that motivated
the loose-typing decision: "BAL." and "trial-274" in normally-numeric
columns, and a free-text note row interleaved between job rows.

    pip install --user pytest mongomock
    python -m pytest api\\test_app.py -v
"""
import mongomock
import pytest

import db as db_module
import app as app_module


@pytest.fixture(autouse=True)
def fake_db(monkeypatch):
    client = mongomock.MongoClient()
    fake = client[db_module.DB_NAME]
    monkeypatch.setattr(db_module, "_client", client)
    monkeypatch.setattr(db_module, "get_db", lambda: fake)
    monkeypatch.setattr(app_module, "get_db", lambda: fake)
    return fake


@pytest.fixture
def client():
    app_module.app.testing = True
    return app_module.app.test_client()


REAL_PRESS1_ROWS = [
    {"kind": "job", "die_no": "173", "suffix": "270", "job_no": "125871",
     "part_no": "173X-1", "alloy_temper": "6063B-T5", "blts": "27",
     "cut_length": "184.4", "est_wt_ft": "0.518", "cast_no": "27013",
     "blt_length": "23", "blts_ran": "9", "die_temp": "747",
     "start_time": "06:44", "stop_time": "07:14"},
    # real entry: "BAL." (run whatever billet stock is left) - not a number
    {"kind": "job", "die_no": "173", "suffix": "269", "job_no": "125871",
     "part_no": "173X-1", "alloy_temper": "6063B-T5", "blts": "BAL.",
     "cut_length": "184.4", "est_wt_ft": "0.518", "cast_no": "27013",
     "blt_length": "23", "blts_ran": "2", "die_temp": "749",
     "start_time": "07:16", "stop_time": "07:31"},
    # real entry: "trial-274" in the Suffix column - not a number
    {"kind": "job", "die_no": "173", "suffix": "trial-274", "job_no": "125871",
     "part_no": "173X-1", "alloy_temper": "6063B-T5", "blts": "4",
     "cut_length": "184.4", "est_wt_ft": "0.518", "cast_no": "27013",
     "blt_length": "23", "blts_ran": "3", "die_temp": "746",
     "start_time": "07:33", "stop_time": "07:51"},
    {"kind": "note", "text": "Load in castool"},
]

PRESS1_BODY = {
    "date": "2026-09-23",
    "roster": {"press_op": "", "saw_op_1": "", "saw_op_2": "",
               "reviewed_by": "", "oven_probes": ""},
    "columns": ["die_no", "suffix", "job_no", "part_no", "alloy_temper",
                "blts", "cut_length", "est_wt_ft", "cast_no",
                "blt_length", "blts_ran", "die_temp", "start_time", "stop_time"],
    "rows": REAL_PRESS1_ROWS,
}


def test_health(client):
    res = client.get("/")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


def test_get_missing_schedule_is_404(client):
    res = client.get("/api/schedule/PRESS 1/Wednesday/1st")
    assert res.status_code == 404


def test_put_then_get_round_trips_real_shaped_data(client):
    res = client.put("/api/schedule/PRESS 1/Wednesday/1st", json=PRESS1_BODY)
    assert res.status_code == 200
    saved = res.get_json()
    assert saved["press"] == "PRESS 1"
    assert saved["day_of_week"] == "Wednesday"
    assert saved["shift"] == "1st"
    assert saved["updated_at"]

    res = client.get("/api/schedule/PRESS 1/Wednesday/1st")
    assert res.status_code == 200
    got = res.get_json()
    assert got["rows"] == REAL_PRESS1_ROWS
    # order preserved exactly - row order IS the run sequence (see README)
    assert [r.get("suffix") for r in got["rows"] if r["kind"] == "job"] == \
        ["270", "269", "trial-274"]


def test_bal_and_trial_values_are_not_rejected(client):
    """The whole reason fields are free-text strings, not typed numbers."""
    res = client.put("/api/schedule/PRESS 1/Wednesday/1st", json=PRESS1_BODY)
    assert res.status_code == 200
    body = res.get_json()
    bal_row = next(r for r in body["rows"] if r.get("suffix") == "269")
    assert bal_row["blts"] == "BAL."
    trial_row = next(r for r in body["rows"] if r.get("blts") == "4")
    assert trial_row["suffix"] == "trial-274"


def test_note_row_preserved_in_position(client):
    client.put("/api/schedule/PRESS 1/Wednesday/1st", json=PRESS1_BODY)
    res = client.get("/api/schedule/PRESS 1/Wednesday/1st")
    rows = res.get_json()["rows"]
    assert rows[-1] == {"kind": "note", "text": "Load in castool"}


def test_put_rejects_bad_row_kind(client):
    bad = dict(PRESS1_BODY, rows=[{"kind": "sidebar", "text": "nope"}])
    res = client.put("/api/schedule/PRESS 1/Wednesday/1st", json=bad)
    assert res.status_code == 400
    assert "kind" in res.get_json()["error"]


def test_put_rejects_non_string_columns(client):
    bad = dict(PRESS1_BODY, columns=["die_no", 123])
    res = client.put("/api/schedule/PRESS 1/Wednesday/1st", json=bad)
    assert res.status_code == 400


def test_save_appends_to_history_without_losing_current(client):
    first = dict(PRESS1_BODY, rows=[{"kind": "note", "text": "version one"}])
    second = dict(PRESS1_BODY, rows=[{"kind": "note", "text": "version two"}])
    client.put("/api/schedule/PRESS 1/Wednesday/1st", json=first)
    client.put("/api/schedule/PRESS 1/Wednesday/1st", json=second)

    current = client.get("/api/schedule/PRESS 1/Wednesday/1st").get_json()
    assert current["rows"][0]["text"] == "version two"

    hist = client.get(
        "/api/schedule/PRESS 1/Wednesday/1st/history"
    ).get_json()["history"]
    assert len(hist) == 2
    # newest first
    assert hist[0]["rows"][0]["text"] == "version two"
    assert hist[1]["rows"][0]["text"] == "version one"


def test_different_press_day_shift_are_independent(client):
    client.put("/api/schedule/PRESS 1/Wednesday/1st", json=PRESS1_BODY)
    res = client.get("/api/schedule/PRESS 4/Wednesday/1st")
    assert res.status_code == 404  # a save to Press 1 must not leak into Press 4


def test_list_schedules_reflects_saved_slots_only(client):
    assert client.get("/api/schedules").get_json()["schedules"] == []
    client.put("/api/schedule/PRESS 1/Wednesday/1st", json=PRESS1_BODY)
    schedules = client.get("/api/schedules").get_json()["schedules"]
    assert len(schedules) == 1
    assert schedules[0]["press"] == "PRESS 1"


def test_press4_extra_column_is_not_rejected(client):
    """Press 4's real file has a column ("Str blt length") Press 1's does
    not - confirming the schema doesn't hardcode one column set."""
    press4_body = dict(PRESS1_BODY)
    press4_body["columns"] = PRESS1_BODY["columns"][:9] + \
        ["str_blt_length"] + PRESS1_BODY["columns"][9:]
    res = client.put("/api/schedule/PRESS 4/Wednesday/2nd", json=press4_body)
    assert res.status_code == 200
    assert "str_blt_length" in res.get_json()["columns"]
