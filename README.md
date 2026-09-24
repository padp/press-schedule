# Press Schedule

Replaces the Excel files the scheduling team and press operators currently
share for shift-by-shift press schedules, with a web app both roles use
directly - removing the reason two people would ever need to edit the same
live file.

## The problem this replaces

Today, each press's schedule lives in 15 `.xls` files under
`\\lud-storage.whitehallindustries.com\Press Schedules\PRESS <N> - PRESS SCHEDULES\`
- one per (day of week x shift), reused every week by typing over last
week's entries. Confirmed directly from real, currently-live files (Press 1
and Press 4, inspected 2026-09-23):

- **Legacy format is fragile.** This machine's own Excel Trust Center
  refuses to open these files via automation at all ("blocked by your File
  Block settings"), and the used range on both sampled files reports
  ~65,000 rows of stray formatting bloat around a few dozen real rows of
  data - a classic old-`.xls` corruption/bloat pattern.
- **History is thrown away weekly.** The same 15 files get overwritten in
  place every week; last week's actual plan is gone the moment this week's
  is typed in.
- **Two people can't safely edit it at once** - it's one file on an SMB
  share, opened directly in Excel by whoever needs to change it.

## Architecture

    Scheduling team  ---\
                          >---  web app (grid UI)  ---  MongoDB Atlas (source of truth)
    Press operator   ---/                                      |
                                                                 | polled periodically
                                                                 v
                                              local script on the plant network
                                                                 |
                                                                 v
                                    \\...\PADUCAH - Press & Production\Press Reports\*.xlsx
                                        (generated snapshot - read by people, never read back)

- **MongoDB Atlas** holds the actual schedule. Both roles write here,
  through the same web app - not through a shared file.
- **Flask API on Render**, matching `picos` / `granco_monitor` /
  `oven_monitor`'s existing pattern (same `SQL_PASS` env convention,
  `pymongo`).
- **React frontend on GitHub Pages**, same split as those sibling projects.
  The grid is a bespoke component built for this sheet's actual shape (see
  "Why not a spreadsheet library" below), not an embedded generic
  spreadsheet.
- **One local, one-way export script**, running as a scheduled task on a
  plant-network machine (mirroring `Die History`'s `scheduled/run_nightly.cmd`
  pattern, but polling far more often - schedules change throughout the
  day, not once a night). It reads current state and writes a `.xlsx`
  snapshot to `Press Reports` for anyone who wants to see it in a familiar
  file - and satisfies the ask to keep producing a real Excel file. That
  file is **never read back** by anything; Mongo is the only source of
  truth, so there is nothing to reconcile and no file lock to fight.

This keeps exactly one piece of the two-way relayer idea from the original
design - a local writer with plant-network access - and drops the half that
would have had to watch an open Excel file for operator edits and diff it
against the database.

## Why not a two-way file sync

The original design had the scheduling team edit the live file directly and
a local relayer push their changes into Mongo, with the reverse also true
for the operator's actuals. Dropped because:

- **Windows file locking.** Overwriting a file an operator has open in
  Excel either fails outright or, worse, gets silently reverted when they
  hit save on their now-stale copy.
- **Feedback loops.** Two independent writers (the file and Mongo) each
  reacting to the other's changes need very careful "is this my own write
  echoing back" detection, or they ping-pong.
- **Diffing raw Excel edits is fragile.** Excel gives no change log; you'd
  have to diff cell-by-cell between versions and handle inserted/deleted
  rows shifting everything else - a much harder problem than it looks, and
  one this plant's other Excel-adjacent projects have not needed to solve.

Putting both roles on the same web app removes the second writer entirely.

## Why not an off-the-shelf spreadsheet component

Considered a generic embeddable spreadsheet (Luckysheet, Fortune-Sheet, and
similar) for the "feels like Excel" requirement. Rejected once the actual
sheet structure was inspected: it isn't a plain rectangular grid.

- A title/date header row, a labeled roster panel (Press Op, Saw Op #1,
  Saw Op #2, Reviewed By, Oven Probes) sitting **beside** the job table
  rather than below it, and the job table itself all share one sheet.
- **Row order carries meaning** - it's the run sequence, not a sortable
  table (confirmed: Press 1's suffixes run 270, 269, 274, 258, 25... with
  no other ordering).
- **Free-text instruction rows sit inside the job list** - `WATCH FOR
  PICKUP`, `ALLOY CHANGE`, `Heat-treat all`, `back up` all appear as their
  own rows at the exact point in the sequence they apply to.
- **The exact column set differs by press.** Press 4's sheet has a
  `Str blt length` column Press 1's doesn't.

A generic spreadsheet engine is the right tool when you want arbitrary
formula-driven grids; this is one specific, irregular form that happens to
live in Excel today. A purpose-built grid can represent its actual shape
directly - the header, the side panel, insertable note rows, per-press
column sets - none of which a generic component assumes.

## Data model (draft)

One document per (press, day of week, shift) - matching the current filing
convention, so this is the same 15-slot mental model per press, not a
process change:

```json
{
  "_id": "press1_wednesday_1st",
  "press": "PRESS 1",
  "day_of_week": "Wednesday",
  "shift": "1st",
  "date": "2026-09-23",
  "roster": {
    "press_op": "", "saw_op_1": "", "saw_op_2": "",
    "reviewed_by": "", "oven_probes": ""
  },
  "columns": ["die_no", "suffix", "job_no", "part_no", "alloy_temper",
              "blts", "cut_length", "est_wt_ft", "cast_no",
              "blt_length", "blts_ran", "die_temp", "start_time", "stop_time"],
  "rows": [
    {"kind": "job", "die_no": "173", "suffix": "270", "job_no": "125871",
     "part_no": "173X-1", "alloy_temper": "6063B-T5", "blts": "27",
     "cut_length": "184.4", "est_wt_ft": "0.518", "cast_no": "27013",
     "blt_length": "23", "blts_ran": "9", "die_temp": "747",
     "start_time": "06:44", "stop_time": "07:14"},
    {"kind": "job", "die_no": "173", "suffix": "269", "...": "...", "blts": "BAL."},
    {"kind": "job", "suffix": "trial-274", "...": "..."},
    {"kind": "note", "text": "Load in castool"},
    {"kind": "job", "...": "..."},
    {"kind": "note", "text": "ALLOY CHANGE"}
  ],
  "updated_at": "...", "updated_by": "..."
}
```

Deliberate choices:

- **`columns` is per-document (really: per-press), not hardcoded** - Press 1
  and Press 4 don't have the same column set, confirmed directly. The grid
  renders whatever columns a press's schedule declares.
- **Every job field is a free-text string, not a typed number.** Real,
  currently-valid entries include `"BAL."` (run whatever billet stock is
  left) in a numeric-looking column and `"trial-274"` in a suffix column.
  Rejecting these on day one would be a regression, not an improvement.
  Softer validation (e.g. a warning, not a block, when a normally-numeric
  field holds non-numeric text) can come later once real patterns are well
  understood.
- **`rows` is an ordered array**, because position is the run sequence.
  The grid needs real reordering (drag, or move-up/move-down), not sorting.
- **`kind: "note"` rows are plain text**, inserted wherever the scheduler
  wants an instruction to appear. The schema doesn't try to interpret what
  `ALLOY CHANGE` or `back up` *mean* - that stays human-readable, same as
  today, rather than guessing at a taxonomy from two sampled files. (A
  sparse job row immediately followed by a `"back up"` note appears to mark
  a contingency/fallback job in Press 4's file - read from two examples,
  not confirmed with anyone who actually writes these.)
- **Times are `"HH:MM"` strings**, not Excel's fractional-day floats
  (`0.280555... == 6:44 AM` in the source files) - converted explicitly at
  both the legacy-file migration boundary and the `.xlsx` export boundary.
  One real source file drives a time value from a macro-backed `Timestamp()`
  formula rather than a typed entry (see CLAUDE.md) - not yet reconciled,
  since nothing here executes Excel formulas or VBA.
- **`roster` keys are not fixed either, for the same reason `columns`
  isn't.** A second real schedule folder (see CLAUDE.md - "The Press
  Reports folder") uses `SUPERVISOR:` where the first uses `REVIEWED BY:`.
  The API already validates `roster` as a plain string-keyed object with no
  required key set, and the grid already renders whatever keys a document
  has - this needed no code change, only confirming the design already
  covered it. Only a brand-new, never-saved slot's starting template
  assumes one fixed 5-field set; that's a convenience default, not a
  constraint on real data.
- **Efficiency-tracking formulas are explicitly out of scope.** The Press
  Reports folder computes `Minutes Per Die`, `Gross Pounds/Hour`,
  `Time/Die Change`, `Downtime`, and `Taper Quench` via autofilled Excel
  formulas. Decided not to replicate these here - if that folder turns out
  to belong to Press 2, `picos` likely already computes equivalent metrics
  live from the PLC, and maintaining two independently-typed sources of the
  same numbers would be worse than leaving one out.

Every save also appends to a `schedule_history` collection (full document
snapshot + timestamp + editor) - free with a real database, and it's the
thing the current file-overwrite workflow can't do. The "current" document's
identity still follows the day-of-week/shift convention as requested; this
only adds a record of what it used to say.

## Known gaps / open questions

- **Only Press 1 and Press 4 have been inspected.** Presses 3 and 5 should
  be spot-checked before the column-set list is treated as final - this
  project's convention (a per-press `columns` list, not one fixed set) is
  designed to absorb differences, but the actual sets still need confirming.
- **No Excel formulas found** in either sampled file - checked via `xlrd`
  against real production data, not via Excel COM (blocked by this
  machine's Trust Center for legacy `.xls`). Absence is inferred, not
  proven; worth a direct check via a machine that isn't locked down.
- **Concurrent-edit model not yet decided.** Proposed default: last-write-
  wins per field, with the grid live-refreshing so simultaneous viewers see
  changes appear - simple to build, and probably sufficient given today's
  single-file-at-a-time editing pattern, but not yet confirmed against how
  often two people actually touch the same shift concurrently.
- **The "op sec" reason for keeping a real `.xlsx`** wasn't fully specified.
  Working assumption: continuity/compliance, not a technical dependency -
  nothing downstream parses this file automatically. Worth confirming,
  since it affects how much fidelity the generated file actually needs.
- **Whether the press-floor terminal has outbound internet access** hasn't
  been confirmed. The cloud-hosted decision assumes yes; if the terminal
  the operator actually uses is locked to the plant LAN, this needs to move
  to a local Flask/Tornado app instead (matching `Vision System Database` /
  `Press History UI`).
- **`Press Reports`, the intended destination for the generated `.xlsx`
  snapshots, does not exist yet** under `PADUCAH - Press & Production` -
  confirmed directly. It needs creating before the export script can write
  there.
