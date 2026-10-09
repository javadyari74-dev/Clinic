/**
 * Clinic-local (Asia/Tehran, UTC+03:30, no DST since 2022) calendar helpers.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which between
 * 00:00 and 03:30 Tehran time is still "yesterday". Use these instead.
 */
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000; // 12_600_000

/** Today's date in Tehran as YYYY-MM-DD. */
export function tehranTodayISO(now: number = Date.now()): string {
  return new Date(now + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Current wall-clock time in Tehran as HH:MM. */
export function tehranNowHHMM(now: number = Date.now()): string {
  return new Date(now + TEHRAN_OFFSET_MS).toISOString().slice(11, 16);
}
