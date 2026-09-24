"""Press Schedule API - Flask over MongoDB.

One document per (press, day_of_week, shift) - the same 15-slot-per-press
filing convention the current Excel process uses. Every PUT overwrites the
current document AND appends a full snapshot to schedule_history, so the
weekly-overwrite habit this replaces no longer throws away what a slot used
to say.

See README.md for the data model and why it looks the way it does, and
CLAUDE.md for what was learned inspecting real, currently-live schedule
files before any of this was written.
"""
import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from flask_cors import CORS

from db import ensure_indexes, get_db

app = Flask(__name__)
CORS(app)

if os.environ.get("SQL_PASS"):
    # Skipped at build time (no SQL_PASS yet) - runs at import time so it
    # also happens under gunicorn, not just `python app.py`. Same guard
    # picos / Granco Saw Monitor use.
    ensure_indexes()


def _key(press, day_of_week, shift):
    return {"press": press, "day_of_week": day_of_week, "shift": shift}


def _validate_schedule_body(body):
    """Loose on purpose - see README's "Deliberate choices". Structural
    checks only; this never rejects a save because a field is non-numeric,
    since real production entries like "BAL." and "trial-274" are valid.
    """
    if not isinstance(body, dict):
        return "body must be a JSON object"

    rows = body.get("rows")
    if rows is not None:
        if not isinstance(rows, list):
            return "rows must be a list"
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                return f"rows[{i}] must be an object"
            kind = row.get("kind")
            if kind not in ("job", "note"):
                return f'rows[{i}].kind must be "job" or "note" (got {kind!r})'
            if kind == "note" and not isinstance(row.get("text", ""), str):
                return f"rows[{i}].text must be a string"

    columns = body.get("columns")
    if columns is not None and not (
        isinstance(columns, list) and all(isinstance(c, str) for c in columns)
    ):
        return "columns must be a list of strings"

    roster = body.get("roster")
    if roster is not None and not (
        isinstance(roster, dict)
        and all(isinstance(k, str) and isinstance(v, str) for k, v in roster.items())
    ):
        return "roster must be an object of string -> string"

    return None


@app.get("/")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/schedules")
def list_schedules():
    """Index of every slot that has ever been saved, for a nav/landing view.

    Does NOT include slots that simply haven't been touched yet - the
    frontend already knows the full (day, shift) grid per press and fills
    in "not yet created" for whatever's missing from this list.
    """
    db = get_db()
    docs = list(
        db.schedules.find(
            {},
            {"_id": 0, "press": 1, "day_of_week": 1, "shift": 1,
             "date": 1, "updated_at": 1, "updated_by": 1},
        )
    )
    return jsonify({"schedules": docs})


@app.get("/api/schedule/<press>/<day_of_week>/<shift>")
def get_schedule(press, day_of_week, shift):
    db = get_db()
    doc = db.schedules.find_one(_key(press, day_of_week, shift), {"_id": 0})
    if doc is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(doc)


@app.put("/api/schedule/<press>/<day_of_week>/<shift>")
def put_schedule(press, day_of_week, shift):
    body = request.get_json(silent=True)
    if body is None:
        return jsonify({"error": "expected a JSON body"}), 400
    err = _validate_schedule_body(body)
    if err:
        return jsonify({"error": err}), 400

    db = get_db()
    now = datetime.now(timezone.utc)
    doc = dict(body)
    doc.update(_key(press, day_of_week, shift))
    doc["updated_at"] = now.isoformat()
    # No login system yet (see README's open questions) - "editor" is just
    # whatever freeform name the client sends, same low-friction convention
    # as the paper form's "REVIEWED BY:" line. Never required.
    doc["updated_by"] = body.get("editor") or None
    doc.pop("editor", None)

    db.schedules.replace_one(_key(press, day_of_week, shift), doc, upsert=True)

    history_doc = dict(doc)
    history_doc["saved_at"] = now.isoformat()
    db.schedule_history.insert_one(history_doc)

    return jsonify(doc)


@app.get("/api/schedule/<press>/<day_of_week>/<shift>/history")
def get_schedule_history(press, day_of_week, shift):
    db = get_db()
    limit = min(int(request.args.get("limit", 20)), 100)
    docs = list(
        db.schedule_history.find(_key(press, day_of_week, shift), {"_id": 0})
        .sort("saved_at", -1)
        .limit(limit)
    )
    return jsonify({"history": docs})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5059)), debug=True)
