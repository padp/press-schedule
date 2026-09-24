# Working on this project

Read `README.md` for what the system is and why it's built this way. This
file is for things a session picks up the hard way.

## Deploying the API (Vercel)

The Flask API deploys as a Vercel Function - a real architecture change
from the original Render plan (README's "Architecture" section is updated;
this records the mechanics). Confirmed directly against Vercel's own docs
(https://vercel.com/docs/frameworks/backend/flask, fetched 2026-09-24) and
by actually deploying, not assumed:

- **Vercel auto-detects a Flask `app` only at specific root-level
  filenames** (`app.py`/`index.py`/`server.py`/`main.py`/`wsgi.py`/
  `asgi.py`, or the same inside `src/`/`app/`) - never arbitrarily nested.
  `api/app.py` doesn't match that on its own.
- **The fix used here: scope the whole Vercel project to the `api/`
  subdirectory**, via `--cwd api` on every `vercel` command - not a root
  shim file. This makes `api/app.py` a directly-detected entrypoint with
  zero rename, and - just as important - it means the sibling
  `package.json`/React `src/` (this project's frontend) are OUTSIDE
  Vercel's view entirely, so there's no risk of framework auto-detection
  getting confused by a Node project sitting next to a Python one in the
  same repo. Every command below needs `--cwd api` (or run from inside
  `api/` directly) for this reason.
- **`requirements.txt` lives in `api/`, not the project root** - Vercel's
  Python runtime looks for it relative to whatever it's treating as project
  root, which is `api/` once scoped this way.
- `gunicorn` was dropped from `requirements.txt` - it was only ever needed
  for the abandoned Render/traditional-WSGI-server plan. Vercel's Python
  runtime wraps the Flask `app` directly.

Commands:

    vercel link --cwd api -y -p press-schedule-api    # one-time
    vercel deploy --cwd api --prod -y                 # deploy current files
    vercel git connect --cwd api                       # auto-deploy on push

Deployed: `https://press-schedule-api.vercel.app` (project
`yellow-james-projects/press-schedule-api`).

**`vercel git connect` fails as of 2026-09-24** - "Failed to connect
padp/press-schedule to project... Make sure you have access to the
repository." This is not a CLI/config problem - the Vercel GitHub App isn't
authorized for the `padp` GitHub org yet, which needs an org admin to grant
it through GitHub's own OAuth/App-installation flow in a browser (Vercel
dashboard -> Project -> Settings -> Git -> Connect, or
https://github.com/apps/vercel/installations/new). Until that's done,
deploys are manual (`vercel deploy --cwd api --prod -y` after every real
change) rather than automatic on push - a real gap, not a preference.

**`SQL_PASS` is not set on Vercel** - this machine has never held that
credential (same gap as the original Render plan). Every Mongo-touching
endpoint 500s until it's added - confirmed directly (`GET /` returns 200
with no Mongo involved; `GET /api/schedules` returns a 500 without it).
Add it via `vercel env add SQL_PASS production --cwd api` (prompts for the
value, never put it in a file or a command line argument where it could
end up in shell history) or the Vercel dashboard -> Project -> Settings ->
Environment Variables. Needs a `vercel deploy --cwd api --prod -y` after
adding it - env var changes don't retroactively apply to an already-built
deployment.

Minimum Vercel CLI version for this Flask flow is 48.2.10 - confirmed the
hard way: `vercel link` failed outright on 37.14.0 with "Your Vercel CLI
version is outdated." `npm i -g vercel@latest` fixed it (60.0.0 at the
time).

## Verifying the .xlsx export without touching real files

`tools/export_xlsx.py` (`write_schedule_xlsx(doc, path)`) writes one
schedule document out as a real `.xlsx` - the one-way snapshot described in
README's Architecture. `tools/test_output/` is where it's exercised during
development - gitignored, and the test suite's `clean_output` fixture wipes
it after every run. **Never point this function at `Press Schedules\` or
`Press Reports\` until the scheduled job that owns that responsibility is
actually built and reviewed** - same rule as reading the legacy files,
now applying to writing too.

    python -m pytest tools\\test_export_xlsx.py -v

Deliberately NOT a byte-for-byte reproduction of the real sheet's layout
(that one pads ~55 blank rows between the header and the roster panel,
matched to a printed paper form - see "Row semantics" below). The export
lays out the same information compactly instead: title + date, roster,
then the job/note grid - nobody reading a generated snapshot benefits from
reproducing dead paper-form spacing.

Column typing survives the export, not just the grid - a `column_types`
"number" column is written as a real Excel number (openpyxl infers the
type from the Python value passed in), and `start_time`/`stop_time` become
real Excel time values, not text. Confirmed directly, not assumed: dumped
a generated file's full cell contents and checked `isinstance(value,
(int, float))` / `datetime.time` for both, plus confirmed a "BAL." in a
non-numeric column is NOT coerced just because a numeric column sits next
to it in the same row.

## Where things are

| | |
|---|---|
| This project | `\\file1\User\Extrusion DB\Press Schedule` |
| Current schedule files, presses 1/3/4/5 (read-only reference, being replaced) | `\\lud-storage.whitehallindustries.com\Press Schedules\PRESS <N> - PRESS SCHEDULES\` (15 `.xls` files per press: one per day-of-week x shift, Mon-Fri only) |
| **A second, materially different live schedule/report system, believed to be Press 2 - see "The Press Reports folder" below** | `Y:\PADUCAH - Press Schedules\Press Reports\` = `\\lud-storage.whitehallindustries.com\PADUCAH - Press & Production\PADUCAH - Press Schedules\Press Reports\` |
| Intended `.xlsx` snapshot destination (does not exist yet - create it) | `\\lud-storage.whitehallindustries.com\PADUCAH - Press & Production\Press Reports` |

**`Y:` is not a fixed path** - it's a per-session mapped drive to
`PADUCAH - Press & Production`. Confirmed on this machine via
`(Get-PSDrive Y).DisplayRoot` / `net use Y:`; don't assume `Y:` means the
same thing on a different machine without checking there too.

## The "Press Reports" folder - a second, more complete system (found 2026-09-24)

The user's own path reference (`Y:\PADUCAH - Press Schedules\Press Reports`)
led to a folder never previously explored - genuinely live (files touched as
recently as the same morning this was found; a stray `.tmp` lock file was
present, meaning someone had one open) and structurally different from the
`PRESS <N> - PRESS SCHEDULES` folders documented above:

- **Covers all 7 days**, not just Monday-Friday - files `A-1` through `G-3`
  (letter = day, Monday=A...Sunday=G; number = shift). Saturday/Sunday files
  exist but are touched far less often (one hadn't been modified since 2023).
- **No press number appears anywhere in the file** - not in the filename, not
  in a title cell (row 0 here is an instruction banner, not a "PRESS N"
  title the way the other folder's files have one). Inferred, not confirmed,
  to be Press 2 specifically, from sibling folders one level up
  (`2021/2022/2023 Press 2 - Top Ten`) - **needs confirming with the user**,
  since Press 2 is the same press `picos` already monitors live, which raises
  a real scope question (see below).
- **Has VBA macros that matter**, unlike anything seen in the other folder.
  Extracted read-only via `oletools.olevba` (`python -m oletools.olevba
  <path>`, no Excel needed, works on both `.xls` and `.xlsm`). Decompiled
  source, not just oletools' generic "suspicious keyword" flags (which fired
  on ordinary `Call`/hex/base64-looking short strings here - false positives,
  confirmed by reading the actual code: no `Shell`, no `CreateObject`, no
  network activity):
  - `Workbook_Open` runs `PullFormulas` (autofills formula columns `U:Z` and
    `AV:BD` down to a row found by searching for the text `"Press
    Efficiency"`) and `EnsureWorksheetNames` (cosmetic sheet-tab rename
    parsed from the filename), then schedules `SaveData` via
    `Application.OnTime` **5 minutes later**.
  - `SaveData` saves the workbook and re-arms itself - **the file autosaves
    itself every 5 minutes while open**, re-running `PullFormulas` each time.
  - A custom `Timestamp(referenceCell)` function returns the current time if
    a reference cell is non-blank, else 0 - used as a formula, meaning
    **some time values are formula-generated the instant an adjacent cell is
    filled in, not typed by hand**. Not yet confirmed which cells use it.
- **A formula-driven efficiency-tracking block exists to the right of the
  job columns** (confirmed via a full-width scan, not assumed from the macro
  alone): `Minutes Per Die`, `Gross Pounds/Hour`, `Time/Die Change`,
  `Downtime`, `Taper Quench`, plus raw `start (min)`/`finish (min)` columns.
  **Open scope question**: replicate this in the web app, or leave it out on
  the theory that `picos` already computes equivalent live metrics for
  whatever press this turns out to be? Not decided - don't build either way
  without asking.
- **Extra job-row columns beyond what's documented above**: `Die Failure`
  (Yes/No), `Die Pull` (Yes/No), `Comments` (free text). Confirms again that
  `columns` must stay per-press/per-document, not hardcoded - now three
  different real column sets observed (Press 1, Press 4, this one).
- **The roster panel is the same 5 fields already modeled** (`README`'s
  `roster` object), just relabeled once (`SUPERVISOR:` here vs. this other
  folder's `REVIEWED BY:`) and positioned at the bottom of the sheet
  (rows ~61-65) instead of beside the header - confirms the *fields* were
  right, but the roster's label set should be per-press/configurable too,
  same reasoning as `columns`.
- Same free-text note-row pattern holds (`ALLOY CHANGE to `), and the same
  kind of stray junk data appears (a lone `` ` `` character sitting alone in
  a `Cut length` cell on one row) - more confirmation the loose-typing
  decision is correct, not something to tighten up.

## Reading the legacy `.xls` files

- **Bash cannot reach these UNC paths at all** (different path-resolution
  layer than native Windows tools) - use the PowerShell tool for anything
  touching `\\lud-storage...` or `\\file1...`, the same lesson as every
  other project in this workspace.
- **This machine's Excel Trust Center blocks opening `.xls` via COM
  automation** ("Sorry, we couldn't find..." / "blocked by your File Block
  settings") even with `ReadOnly=True`. Use `xlrd` instead - it reads the
  legacy binary format directly with no Excel involved. Confirmed working:
  `xlrd.open_workbook(path, formatting_info=True)`.
  - `xlrd` only opens `.xls`, never `.xlsx`/`.xlsm` - a handful of files in
    these folders are already `.xlsx` (e.g. `COMMONLY RUN - PRESS 3.xlsx`
    lives in a sibling directory); those need `openpyxl` instead.
  - `xlrd` gives you cell **values**, not formula text - it cannot confirm
    or deny formulas the way opening in real Excel would. Formula-presence
    conclusions from `xlrd` alone are "none observed," not "none exist."
- **Sheet index 0 is a blank template placeholder** (`"XXXXXX"`), not the
  data. The real sheet is named after the day+shift (e.g.
  `"Wednesday 1st shift"`) - same pattern `Die History` hit with its blank
  `"Master Page"` sheet. Find the data sheet by name, never by index.
- **`sheet.nrows` lies.** Both sampled files reported ~65,000 rows from
  stray formatting bloat on a handful of real data rows. Don't iterate the
  full reported range when parsing for migration - scan until a large
  contiguous blank run past the last real row, or cap at a sane bound
  (a few hundred rows is generous for one shift).
- **Time-of-day cells are Excel's fractional-day float serials**, not
  datetimes - `0.2805555... == 6:44 AM`. Convert explicitly both when
  reading a legacy file and when writing the `.xlsx` export.
- **The column set is not the same across presses.** Press 1's sheet has 14
  columns ending `..., Die temp, Start time, Stop time`; Press 4's sheet
  inserts an extra `Str blt length` column between `Cast #` and
  `blt length`. Confirmed by direct inspection, not assumed - don't
  hardcode one column list for every press; each press's schedule document
  carries its own `columns` array (see README's data model).

## Row semantics, confirmed from real production data (2026-09-23)

- **Row order is the run sequence**, not sortable data. Press 1's suffixes
  ran `270, 269, 274, 258, 25, 24...` - meaningless as a sort key, exactly
  the scheduled order.
- **Free-text note rows are interleaved with job rows on purpose**,
  positioned at the exact point in the sequence they apply to:
  `WATCH FOR PICKUP`, `MAKE SURE SPLIT`, `Load in castool`, `ALLOY CHANGE`
  (Press 1); `Heat-treat all`, `back up` (x2), `Shut down 3rd...`,
  `Start up first...` (Press 4). Treat these as opaque text, not something
  to parse meaning out of.
- **Job-row fields are not reliably typed**, even where they look numeric.
  Confirmed real values: `# blts` = `"BAL."` (run whatever billet stock is
  left), `Suffix` = `"trial-274"`. Store every job field as a string;
  don't validate strictly against a numeric type.
- **A sparse job row followed by a `"back up"` note** appears twice in the
  Press 4 sample (a job row with only Die #/Job #/Part #/Alloy/Cut
  length/Est wt filled in, missing billet count/cast#/temps, immediately
  followed by a bare `"back up"` row). Reads like a contingency job option,
  but that's inferred from two examples, not confirmed with anyone who
  actually writes these - don't build special handling around it beyond
  what the general job/note model already supports.

## Do not overwrite real files while building/testing this

Every legacy-file read done for design/migration work must be read-only
(`ReadOnly=True` in COM, or `xlrd`'s inherently read-only open) against the
real share. Any generated `.xlsx` produced while developing or testing the
export script goes to a scratch/temp location - never into
`Press Schedules\` or `Press Reports\` - until the export logic is verified
and this note is updated to say otherwise.
