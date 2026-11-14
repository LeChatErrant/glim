# Sunrise follows your alarm

Status: **design**, 2026-11-14. Not built. Canvas:
<https://claude.ai/artifact/G9V6rrNyhv8BVchpGwtKjy> ("Glim small ideas", part 1).

The Sunrise ritual can follow the phone's next alarm instead of a fixed time: set your alarm
in the Clock app as usual, and the lights rise to meet it. Change the alarm, the sunrise moves;
no alarm, no sunrise.

## Behavior

- **"With my alarm"** is a second way to set a Sunrise's time, next to "At a set time".
- **When it ends:** at the alarm (default), or 10, 20 or 30 min before (a light already
  bright when the alarm rings). The fade length stays the Sunrise's own (10–60 min; the
  bridge refuses less than 5 min, verified).
- **Which alarms count:** see options. Default: **the Clock app only**. Android's next alarm
  is set by any app that uses `setAlarmClock` (Clock, sleep apps like Sleep as Android, some
  reminder and calendar-alarm apps); Google Calendar's own reminders are notifications and
  don't set it. Glim tells them apart by the alarm's creator package
  (`AlarmClockInfo.showIntent.creatorPackage`).
- **Alarm changed or set:** the sunrise moves within seconds (Android broadcasts
  `ACTION_NEXT_ALARM_CLOCK_CHANGED`, one of the few broadcasts still delivered to a closed app;
  checked in Android's list of exempted broadcasts). The card says the new time.
- **Alarm set late** (the fade should already have started, e.g. 6:55 for a 7:00 alarm with a
  30 min fade): the bridge **skips** a wake-up whose start has passed (verified: it stays dark
  and rings nothing). Glim shortens the fade to what's left: start on the coming minute
  (at least 15 s away, like Sleep now), end at the alarm, if that leaves 5 min or more; with
  less, the phone fades the lights itself (one `PUT` with `on`, a low level, then the end level
  with `dynamics.duration` = the time left).
- **Snooze:** the Clock app sets a new alarm for the snooze time. An alarm within 30 min after
  the one just followed counts as a snooze. Options below; default: **the lights stay**.
- **Alarm turned off before it rings** (dismissed from the "Upcoming alarm" notification, or
  switched off): the sunrise moves to the next alarm, or goes quiet. If its fade has already
  started, the lights go back off over 1 min: you're sleeping in.
- **No alarm tomorrow:** options below; default **no sunrise** (the card says "Waiting for an
  alarm"). An alarm more than 6 days away is held back (the bridge's days would fire it within
  the week), and Glim checks again daily.
- **Phone off or dead:** the bridge keeps the last sunrise Glim wrote and runs it with the phone
  off (verified for wake-ups: a bridge behavior). The Clock won't ring with the phone off, so the
  light is then the only alarm: on purpose. If the phone stays off a whole week, the same sunrise
  comes back on the same weekday; Glim rewrites it as soon as the phone is back.
- **Away from home** (option, default on when a home location is set): an alarm while the
  phone sleeps away (last geofence: outside) doesn't light an empty home.
- **Time zones:** the alarm is an instant; Glim writes it in the **bridge's** time zone
  (`bridge.time_zone`, here `Europe/Paris`), so travel doesn't shift it.
- The phone does the following; the **bridge still runs the sunrise**, phone on or off.

## Screens

**Sunrise sheet** (`WakeSheet`): the time row becomes a two-way choice.

```
  ┌────────────────────────────────────────┐
  │ [ At a set time ]  [ With my alarm ⏰ ]│
  └────────────────────────────────────────┘
  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ (sunrise strip)
  6:40          30 min · fade in       7:10
  Next alarm  Mon 7:10 · Clock
  ENDS        At the alarm · 10 · 20 · 30 min before
  NO ALARM    No sunrise · At 9:00 (weekends)
  SNOOZE      Lights stay · Dim and rise again
  ALARMS FROM Clock only · Any app
```

Days disappear in alarm mode (the alarm decides). Lights, Fade in, Ends at %, Light (sunrise
colors / plain white) are unchanged.

**Sunrise card** (Rituals tab): "Sunrise · with your alarm", a small alarm-clock mark next to
the sun mark, and the next run "Mon 6:40 → 7:10". No alarm: "Waiting for an alarm" in muted.
Fade running: "Rising · ends 7:10" with Stop (lights stay) as today for a sleep fade.

**First switch to "With my alarm":** no permission needed (reading the next alarm is free). If
no alarm is set, a line under the choice: "Set an alarm in your Clock app; the sunrise will
follow it."

## Options for the maintainer (canvas, part 1)

- **Which alarms.** A **Clock only** (recommended): the system clock app's package. B **Any
  app** that sets an alarm clock. C **Pick apps** (a list of apps seen setting alarms).
- **Days without an alarm.** A **No sunrise** (recommended). B **A fallback time** on chosen
  days (e.g. 9:00 Sat–Sun). C **The usual time**: the last alarm's time again (habit).
- **Snooze.** A **Lights stay** at the end level (recommended). B **Dim and rise again**: the
  lights drop to 30% and rise to the end level by the snooze's end. C **Brighter each snooze**
  (+20% per snooze, up to 100%).
- **Where it shows.** A: a choice inside the Sunrise sheet (recommended). B: its own ritual
  card "Wake with my alarm" next to Sunrise.

## Data model

The bridge holds the sunrise as today (a `behavior_instance` of the wake-up script). The
"follow" settings live on the phone, per bridge, keyed by the behavior's ID, and are mirrored
to `huelab_fast` for the native receiver:

```ts
type AlarmFollow = {
  behaviorId: string;
  offsetMin: 0 | 10 | 20 | 30;
  apps: 'clock' | 'any' | string[];           // creator packages
  noAlarm: { kind: 'none' } | { kind: 'fixed'; at: Clock; days: Day[] } | { kind: 'usual' };
  snooze: 'stay' | 'again' | 'brighter';
  onlyHome: boolean;
  /** What Glim last wrote, to tell a snooze from a new alarm and skip identical writes. */
  last?: { alarmAt: number; endAt: number; writtenAt: number };
};
// WakeRitual (src/lib/rituals/rituals.ts) gains `follow?: Omit<AlarmFollow, 'behaviorId'>`.
```

## Technical approach

- **`AlarmFollow.kt`** (module `hue-http`), a manifest `BroadcastReceiver` for
  `AlarmManager.ACTION_NEXT_ALARM_CLOCK_CHANGED`, `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`,
  `TIME_SET`, `TIMEZONE_CHANGED`. It runs without JS, like `PathOff.kt`:
  1. `alarmManager.nextAlarmClock` → `triggerTime` and `showIntent?.creatorPackage`.
  2. Not a counted app → keep what is on the bridge (see Limits). Snooze window → apply the
     snooze option. Away → disable.
  3. End = alarm − offset, in the bridge's time zone; start = end − fade. Start in the past →
     shortened fade or phone fade (above).
  4. `PUT behavior_instance/{id}` with `enabled`, `configuration.when` =
     `{ time_point: { type: 'time', time: { hour, minute } }, recurrence_days: [weekday] }`,
     keeping the rest of the configuration, through `FastRoute` (bridge, else Hue's cloud).
     `goAsync()` (10 s); on failure a one-off WorkManager job with a network constraint retries.
  5. Writes `last` to `huelab_fast`; the app and the Rituals tab read it.
- The minute is the bridge's granularity: an alarm at 7:10:30 ends the fade at 7:10.
- **Daily check** (WorkManager, inexact): an alarm more than 6 days away gets armed when it
  comes within the week; a stale sunrise (its alarm gone while the phone was off) is fixed.
- **JS:** the sheet and card read `getNextAlarmClock` through the module
  (`nextAlarm(): { at, pkg, label } | null`) and `last`; saving a following Sunrise runs the
  same computation once from JS.
- **Stop while rising** (alarm turned off mid-fade): the bridge can't stop a running wake-up
  (as with sleep fades, switching it off doesn't stop the fade under way): Glim sets each light
  of the target off (no duration, never with `on: false`, see CLAUDE.md) after a 1 min dim.

## What was verified (2026-11-14, real bridge, Salle de bain)

- Wake-up `fade_in_duration` of 60 s and 180 s: **refused** ("Validation error"); 300 s and
  600 s accepted. Minimum fade: **5 min**.
- A one-off wake-up created at 15:09 ending 15:11 with a 5 min fade (start 15:06, already
  past): the light **stayed off** through 15:13, behavior still enabled (it would run the next
  day at 15:11). The bridge skips a late start; it doesn't start part-way.
- A wake-up created at 15:12 ending 15:19 (start 15:14): at 15:14:01 the light reported `on`,
  **60.1%** (the end level) at once: the bridge sends one long transition, and a light reports
  its *target*. Glim can't read fade progress from the light; it computes it from the times.
- Moving the end time of a running wake-up: see "Mid-fade move" below.
- The bridge's time zone is readable: `bridge.time_zone.time_zone` = `Europe/Paris`.
- `ACTION_NEXT_ALARM_CLOCK_CHANGED` is on Android's list of implicit broadcasts exempted from
  background limits (manifest receivers still get it).
- The maintainer's Pixel (Android 17) had **no alarm set** today (`dumpsys alarm`: no next
  alarm clock), so the creator package of a real Clock alarm wasn't read. No alarm was set on
  the phone for testing (it's the maintainer's).

### Mid-fade move

At 15:16:57, with that fade running (started 15:14, end 15:19), the end was moved to 15:22
(a new start at 15:17). The bridge accepted the change; the light kept reporting `on`, 60.1%
through 15:17 and 15:22, so whether the bridge restarted the fade **can't be read from the
API**, and nobody was there to look. Design consequence: Glim **never moves a sunrise while it
rises**. An alarm changed during the fade applies to the next sunrise; a snooze follows the
snooze option; an alarm turned off stops it (above).

## Limits

- **Android shows apps only the soonest alarm of all apps.** If a not-counted app's alarm comes
  first (a 6:30 reminder before a 7:00 Clock alarm), Glim can't see the Clock's 7:00 until the
  6:30 one has rung; it keeps the sunrise it already wrote, which is right unless the Clock
  alarm was changed in between.
- The sunrise ends on the minute.
- A wake-up's end level and colors can't be changed while it runs.
- iOS: no public API for the next alarm (a Shortcuts automation "When alarm is stopped" exists,
  but nothing to read ahead). Android only.

## Open questions

1. Which alarms: Clock only, any app, or picked apps?
2. Days without an alarm: none, a fallback time, or the usual time?
3. Snooze: stay, again, or brighter?
4. Several Sunrises (bedroom and kitchen): can more than one follow the alarm (each with its
   own offset)? Design allows it; default yes.

## Build steps

1. Module: `nextAlarm()` for JS; `AlarmFollow.kt` receiver + manifest; shared helper to write
   the wake-up's `when` (also used from JS).
2. `src/lib/rituals/alarm.ts`: `AlarmFollow` per bridge, sync to `huelab_fast`, the end/start
   computation (snooze window, late start, away, > 6 days).
3. `WakeSheet`: the two-way time choice and the alarm rows; card text.
4. Daily WorkManager check; retry job.
5. Test on the real lights with a real Clock alarm: set, move, snooze, dismiss early, late
   alarm (5 min before), phone in airplane mode (cloud fallback) and off overnight.
