---
name: Birthdate date convention
description: How patient birthdates are stored vs displayed in beauty-clinic, and the Greg/Shamsi guard used across UI and the birthday-reminder backend.
---

# Birthdate convention (beauty-clinic, non-laser)

Patient birthdates are **stored as Gregorian** "YYYY-MM-DD" (the shared `PersianDatePicker` always emits/consumes Gregorian ISO). They are **displayed as Shamsi** — never echo the raw stored string.

- Display: use `formatBirthdate()` in `src/lib/format.ts` (Greg→Shamsi with Persian month name + digits). Used at patient-detail and global-search.
- Backend birthday match (`/patients/upcoming-birthdays`): must convert the stored Gregorian date to Shamsi month/day before matching, otherwise the reminder fires on the wrong day.
- **Greg-vs-Shamsi guard:** a year `> 1700` means the value is Gregorian (convert); `< 1700` means a legacy already-Shamsi value (use as-is). Applied in both `formatBirthdate` and the backend.

**Why:** The picker stores Gregorian, but users enter/expect Shamsi. Earlier the file showed raw Gregorian and the birthday calc treated Gregorian month/day AS Shamsi → wrong birthdays. Storing Gregorian + converting at display/compute time avoids a data migration on installed desktop copies.

**How to apply:** Any new place that shows a birthdate must run it through `formatBirthdate`. Any date-math on birthdate must convert Greg→Shamsi first. The **laser section is intentionally exempt** — its dates stay Gregorian/unchanged.

Related: `PersianDatePicker` uses a Gregorian contract everywhere (value/onChange = Gregorian ISO). For timestamp fields (e.g. reminders `dueAt` unix seconds), convert unix→local Gregorian ISO for the picker and back; do NOT route picker output through any Shamsi conversion.
