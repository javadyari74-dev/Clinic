import { isNotNull } from "drizzle-orm";
import { db, patientsTable } from "@workspace/db";

// ── محاسبه تولدهای پیش‌رو (شمسی) ─────────────────────────────────────────────
// تاریخ تولد ممکن است میلادی (سال > 1700) یا شمسی ذخیره شده باشد.

export function getShamsiPartsServer(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function shamsiToGregorianServer(year: number, month: number, day: number): Date {
  const ref = new Date();
  ref.setHours(12, 0, 0, 0);
  const r = getShamsiPartsServer(ref);
  const approx = Math.round(
    (year - r.year) * 365.25 +
    ((month - 1) * 30.5 + day) - ((r.month - 1) * 30.5 + r.day),
  );
  const base = new Date(ref);
  base.setDate(base.getDate() + approx);
  for (let d = -8; d <= 8; d++) {
    const test = new Date(base);
    test.setDate(test.getDate() + d);
    const p = getShamsiPartsServer(test);
    if (p.year === year && p.month === month && p.day === day) return test;
  }
  return base;
}

export interface UpcomingBirthday {
  patientId: number;
  name: string;
  phone: string;
  birthdate: string;
  birthdayShamsiYear: number;
  birthdayShamsiMonth: number;
  birthdayShamsiDay: number;
  daysUntil: number;
}

export async function getUpcomingBirthdays(daysAhead: number): Promise<UpcomingBirthday[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayShamsi = getShamsiPartsServer(today);

  const patients = await db
    .select()
    .from(patientsTable)
    .where(isNotNull(patientsTable.birthdate));

  const results: UpcomingBirthday[] = [];

  for (const patient of patients) {
    if (!patient.birthdate) continue;
    const parts = patient.birthdate.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) continue;
    let birthMonth: number, birthDay: number;
    if (parts[0] > 1700) {
      // Stored as Gregorian — convert to Shamsi month/day for the birthday match
      const g = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      const sh = getShamsiPartsServer(g);
      birthMonth = sh.month;
      birthDay = sh.day;
    } else {
      // Legacy value already stored as Shamsi
      birthMonth = parts[1];
      birthDay = parts[2];
    }

    // Try this year first, then next year
    for (const yearOffset of [0, 1]) {
      const birthdayYear = todayShamsi.year + yearOffset;
      const birthdayGreg = shamsiToGregorianServer(birthdayYear, birthMonth, birthDay);

      // Verify conversion was accurate (handles invalid dates like Esfand 30 in non-leap)
      const check = getShamsiPartsServer(birthdayGreg);
      if (check.month !== birthMonth || check.day !== birthDay) continue;

      birthdayGreg.setHours(0, 0, 0, 0);
      const diffDays = Math.round(
        (birthdayGreg.getTime() - today.getTime()) / 86400000,
      );

      if (diffDays < 0) continue; // already passed this year, try next
      if (diffDays <= daysAhead) {
        results.push({
          patientId: patient.id,
          name: patient.name,
          phone: patient.phone,
          birthdate: patient.birthdate,
          birthdayShamsiYear: birthdayYear,
          birthdayShamsiMonth: birthMonth,
          birthdayShamsiDay: birthDay,
          daysUntil: diffDays,
        });
      }
      break; // either included or too far ahead — done with this patient
    }
  }

  results.sort((a, b) => a.daysUntil - b.daysUntil);
  return results;
}
