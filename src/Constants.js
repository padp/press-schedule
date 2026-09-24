export const API_BASE = process.env.REACT_APP_SCHEDULE_API_BASE || "http://127.0.0.1:5059";
export const REQUEST_TIMEOUT = 15000;

// The current Excel process's own 15-slot-per-press convention (day of week
// x shift) - kept deliberately, not replaced with real calendar dates, per
// direction. Only the presses actually confirmed to use this filing pattern
// are listed (PRESS 1 and PRESS 4, inspected directly - see CLAUDE.md);
// PRESS 3 and PRESS 5 folders exist on the share but haven't been checked
// yet, so they're not assumed here.
export const PRESSES = ["PRESS 1", "PRESS 4"];
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
export const SHIFTS = ["1st", "2nd", "3rd"];
