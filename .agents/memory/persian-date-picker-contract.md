---
name: PersianDatePicker contract
description: Input/output format of the PersianDatePicker component and how to store its value.
---

# PersianDatePicker contract

The `PersianDatePicker` component displays a Shamsi (Jalali) calendar to the
user, but its `value` and `onChange` are **GREGORIAN** strings in `"YYYY-MM-DD"`
format. Do NOT route its value through any Shamsi conversion before storing.

**Storing into a unix-timestamp field:** parse the Gregorian string and build a
local-noon Date to avoid day-shift across timezones:

```ts
const [y, m, d] = value.split("-").map(Number);
const unix = Math.floor(new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000);
```

**Why noon:** using midnight can shift the calendar day by ±1 under timezone
offsets; noon is safe.
