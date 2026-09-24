# Working on this project

Read `README.md` for what the system is and why it's built this way. This
file is for things a session picks up the hard way.

## Where things are

| | |
|---|---|
| This project | `\\file1\User\Extrusion DB\Press Schedule` |
| Current schedule files (read-only reference, being replaced) | `\\lud-storage.whitehallindustries.com\Press Schedules\PRESS <N> - PRESS SCHEDULES\` (15 `.xls` files per press: one per day-of-week x shift) |
| Intended `.xlsx` snapshot destination (does not exist yet - create it) | `\\lud-storage.whitehallindustries.com\PADUCAH - Press & Production\Press Reports` |

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
