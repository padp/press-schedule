"""MongoDB connection helper.

Same connection pattern as the rest of this codebase (picos, Fetch Log Data,
Granco Saw Monitor): username and cluster host inline, only the password
read from an env var (SQL_PASS). This project gets its OWN database on the
shared cluster (press_schedule, not press_db) - a bad write here can never
touch picos's or any other project's collections, since Mongo isolates at
the database level.
"""
import os

from pymongo import MongoClient

DB_NAME = "press_schedule"

_client = None


def get_db():
    global _client
    if _client is None:
        sql_pass = os.environ["SQL_PASS"]
        _client = MongoClient(
            f"mongodb+srv://padpress1:{sql_pass}@cluster0.ywwxl.mongodb.net/"
            "?retryWrites=true&w=majority&appName=Cluster0"
        )
    return _client[DB_NAME]


def ensure_indexes():
    db = get_db()
    # One current document per (press, day_of_week, shift) - the same
    # 15-slot-per-press identity the paper/Excel process already uses.
    db.schedules.create_index(
        [("press", 1), ("day_of_week", 1), ("shift", 1)], unique=True
    )
    # schedule_history is append-only (one doc per save) - queried by which
    # slot it belongs to, newest first.
    db.schedule_history.create_index(
        [("press", 1), ("day_of_week", 1), ("shift", 1), ("saved_at", -1)]
    )
