# Scheduled Payment Time Zones & DST Behavior

Ledger timestamps on Stellar/Soroban are absolute Unix timestamps anchored in **UTC**. To prevent ambiguity for merchants and subscribers in different regions, the frontend formats scheduled payment due times using `formatScheduleTime` (`frontend/src/lib/schedule_time.ts`) and renders them with `<ScheduleTime />` (`frontend/src/components/ScheduleTime.tsx`).

## Display & Accessibility

- **Local Time with Time Zone Label**: Due dates are displayed in the user's configured/browser time zone with an explicit short time zone abbreviation (for example, `Mar 8, 2026, 03:00 AM EDT` or `Jun 15, 2026, 09:00 PM GMT+9`).
- **Canonical UTC Inspection**: Each scheduled time includes an accessible `UTC` toggle button (`aria-expanded`, `aria-controls`) and a semantic `<time dateTime="...">` element so keyboard, screen-reader, and pointer users can inspect the exact canonical UTC timestamp (e.g. `2026-03-08 07:00:00 UTC`) and IANA time zone name.

## Daylight Saving Time (DST)

- Because the underlying ledger timestamp is fixed in UTC, the local wall-clock hour shifts by 1 hour when a user's time zone transitions into or out of DST.
- The expandable details panel explains whether the user's time zone observes DST and whether DST is active for the scheduled payment date.
- Invalid, zero, or missing timestamps render as `—` without throwing.
