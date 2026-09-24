export const API_BASE = process.env.REACT_APP_SCHEDULE_API_BASE || "http://127.0.0.1:5059";
export const REQUEST_TIMEOUT = 15000;

// The current Excel process's own day-of-week x shift filing convention -
// kept deliberately, not replaced with real calendar dates, per direction.
// Only the presses actually confirmed to use this filing pattern are listed
// (PRESS 1 and PRESS 4, inspected directly - see CLAUDE.md); PRESS 3 and
// PRESS 5 folders exist on the share but haven't been checked yet, so
// they're not assumed here. A second real schedule/report system was found
// under Y:\PADUCAH - Press Schedules\Press Reports, believed but NOT
// confirmed to be Press 2 - not added here as "PRESS 2" until that's
// confirmed, since getting a press's identity wrong is a worse mistake than
// an extra click to reach it once it's added correctly.
export const PRESSES = ["PRESS 1", "PRESS 4"];

// All 7 days: the second schedule system found covers Saturday/Sunday too
// (touched far less often, but real - one file's mtime went back to 2023,
// not absent). Listing an unused day for a press that never runs weekends
// is harmless - it just resolves to "this slot has never been saved."
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const SHIFTS = ["1st", "2nd", "3rd"];
