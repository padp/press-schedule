export const API_BASE = process.env.REACT_APP_SCHEDULE_API_BASE || "http://127.0.0.1:5059";
export const REQUEST_TIMEOUT = 15000;

// Confirmed with the user 2026-09-24: Press 2 is the only press this needs
// to cover - the Y:\PADUCAH - Press Schedules\Press Reports folder is
// Press 2's, and PRESS 1/3/4/5 (the separate PRESS <N> - PRESS SCHEDULES
// share investigated first, before Press Reports was found) are out of
// scope. Kept as a list, not a single constant, in case that ever changes -
// nothing else in the app assumes exactly one press.
export const PRESSES = ["PRESS 2"];

// Confirmed real: Press 2's own files cover all 7 days, Saturday/Sunday
// included (touched far less often, but genuinely used - not absent).
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const SHIFTS = ["1st", "2nd", "3rd"];
