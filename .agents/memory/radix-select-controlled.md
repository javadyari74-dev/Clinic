---
name: Radix Select null focus crash
description: Why Radix Select throws "Cannot read properties of null (reading 'focus')" and the controlled-value fix.
---

# Radix Select "reading 'focus'" runtime crash

Radix `Select` (shadcn `@/components/ui/select`) throws an app-crashing
`TypeError: Cannot read properties of null (reading 'focus')` (from
`@radix-ui/react-select`) when its `value` prop flips between a defined string and
`undefined`. React logs "Select is changing from uncontrolled to controlled"
(and back) right before the crash; on close Radix tries to focus the trigger
whose ref is now null because the toggle effectively remounted it.

**Why:** passing `value={x ? String(x) : undefined}` makes the component
uncontrolled whenever `x` is falsy. A common trigger here: one Select's
`onValueChange` resets another piece of state to `null` (e.g. changing commission
recipient TYPE resets recipient ID), flipping the dependent Select to
uncontrolled while it is open/focused.

**How to apply:** keep every Radix Select permanently controlled. Use `""` (or
`value ?? ""`) instead of `undefined` for the empty case — Radix renders the
placeholder when the value matches no `SelectItem`, and there is no
controlled/uncontrolled switch. Do NOT add a `SelectItem value=""`; empty string
is reserved by Radix. Native `<select><option value="">` (not Radix) is unaffected.
