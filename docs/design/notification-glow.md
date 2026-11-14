# Notification glow

Status: **design**, 2026-11-14. Not built. Canvas:
<https://claude.ai/artifact/G9V6rrNyhv8BVchpGwtKjy> ("Glim small ideas", part 3).

A message from someone who matters, or from an app you pick, makes one light pulse once.
A quiet, glanceable "someone wrote", not an alarm. Never at night unless you ask.

## Behavior

- A **glow rule** says: *when* (an app, a contact, or a contact in an app) → *which light*
  (one light, or a room or group) → *which color* (a color, or the app's own color) → *how*
  (one pulse, or two).
- When a notification matches a rule, the light pulses once and goes back to exactly how it
  was (on or off, color, level). Nothing to restore: the bridge does it (verified, below).
- **Quiet hours** (per rule, default **22:00 to 8:00**, on): no glow. "Never at night" is the
  default; turning quiet hours off is a visible choice on the rule.
- **Only at home** (default on): the glow only fires when the phone reaches the bridge on the
  home Wi-Fi (the transport's local route), so an empty home doesn't blink while you are out.
  Off = also through Hue's cloud.
- **Follow Do Not Disturb** (default on): a notification Android itself silences (DND, a
  silent channel) doesn't glow either.
- **Calm down:** one glow per rule per 2 min (a burst of 6 WhatsApp messages = one pulse).
  Updates of a notification already shown, group summaries, ongoing ones (music, navigation,
  downloads) and Glim's own never count.
- **Only if the light is on** (option, default off): skip lights that are off, for people who
  don't want a dark room to flash.
- Several rules can match one notification: the most specific wins (contact in an app > contact
  > app), one pulse.

## Screens

Lives in the **Rituals** tab, as its own card group "Glows" under Arriving/Leaving (a glow is
an automation: phone-side like Arriving home). One card per rule:

```
  ● Léa · any app            → Lumière de la chambre      ◐ 22:00–8:00
  ● WhatsApp                 → Bureau                      ◐ 22:00–8:00
```

The dot is the glow's color, the half moon says quiet hours are on.

**Glow sheet** (one per rule), led by a sentence like the Arriving sheet (Léa is an example contact): *"When Léa writes,
Lumière de la chambre pulses rose. Not between 22:00 and 8:00."*

1. **From**: Anyone in an app (app list, with icons, apps that posted recently first) /
   A contact (system contact picker: no contacts permission needed) / A contact in one app.
2. **Light**: one light (map picker, like the mood editor's map) or a room/group. Plugs are
   left out (they refuse signaling; verified).
3. **Color**: the favorites row + "App color" (the notification's own accent color, Android's
   `Notification.color`, when the app sets one) + "Two colors" (alternating, for a contact).
4. **Pulse**: Once (one soft on/off in the color) / Twice (alternating two colors).
5. **Quiet hours**: switch + from/to (the time pickers of the Sleep fade sheet).
6. Only at home, Follow Do Not Disturb, Only if the light is on: switch rows.
7. **Try it**: pulses the light now, ignoring quiet hours.

**Notification access moment** (shared with Album colors, see below).

## Options for the maintainer (canvas, part 3)

- **The pulse.** A: Hue's **signal** (`signaling: on_off_color`, the bridge blinks the light in
  the color and puts it back itself; works when the light is off). B: Hue's **breathe**
  (`alert: breathe`, one slow breath in the light's *current* color, no color choice). C: a
  **Glim soft pulse** (two requests: up in the color with a short fade, then back; needs the
  state saved first and can't fade an off light back to off: Hue dims an off-with-duration
  light to ~0%, see CLAUDE.md). **Recommended: A.**
- **Where rules live.** A: Rituals tab, "Glows" group (recommended). B: Settings → Glows.
  C: on the light's own screen ("Glows here").
- **Default when.** A: quiet hours 22:00–8:00 on (recommended, matches "never at night").
  B: only between sunset and 22:00 (when lights are likely on anyway). C: always.

## Data model

Per bridge, on the phone, mirrored to `huelab_fast` as JSON for the native listener:

```ts
type GlowRule = {
  id: string;
  enabled: boolean;
  from:
    | { kind: 'app'; pkg: string; label: string }
    | { kind: 'contact'; name: string; lookupKey?: string; phones?: string[]; pkg?: string };
  target: { kind: 'light' | 'room' | 'group'; id: string }; // light rid, or grouped_light rid
  color: { kind: 'fixed'; xy: [number, number] } | { kind: 'app' } | { kind: 'two'; xy: [[number, number], [number, number]] };
  pulse: 'once' | 'twice';
  quiet: { on: boolean; from: number; to: number }; // minutes since midnight, default 1320 → 480
  onlyHome: boolean;      // default true
  followDnd: boolean;     // default true
  onlyIfOn: boolean;      // default false
};
```

`huelab_fast` key `glowRules`, plus `glowLast` (last fire per rule, for the 2 min calm-down).

## Technical approach

- **Native, like widget taps.** One `NotificationListenerService` in the `hue-http` module,
  `GlimListener.kt`, shared with Album colors (media sessions need the same listener
  component). `onNotificationPosted(sbn, rankingMap)`:
  1. Drop: Glim's own package, `FLAG_ONGOING_EVENT`, `FLAG_GROUP_SUMMARY`, a repost of a key
     already seen with `FLAG_ONLY_ALERT_ONCE`, category `transport`/`progress`/`service`.
  2. Follow DND: `rankingMap.getRanking(key)` → `matchesInterruptionFilter()` false, or
     `importance < IMPORTANCE_DEFAULT` → drop.
  3. Who: `extras.EXTRA_TITLE` (WhatsApp, Signal, Messages put the sender name there),
     `MessagingStyle` last message's `Person.name`, and `EXTRA_PEOPLE_LIST` `Person.uri`
     (`tel:`/`mailto:`/contact lookup URIs). A contact rule matches the picked contact's display
     name (case and accents folded) or one of its phone numbers.
  4. Quiet hours, calm-down, only-at-home (`FastRoute` local probe answered in the last
     minute, or a 1.5 s local try), only-if-on (one `GET light/{id}`).
  5. Send through `FastRoute` (bridge, or the cloud when allowed).
- **The request** (A, recommended), one `PUT`:
  `light/{id}` (or `grouped_light/{id}` for a room/group) with
  `{"signaling":{"signal":"on_off_color","duration":1000,"colors":[{"xy":{…}}]}}`;
  twice = `"alternating"` with 2 colors, 2000 ms.
- **Contact picker:** `ACTION_PICK` on `ContactsContract.Contacts.CONTENT_URI` returns one
  contact with a temporary read grant: Glim keeps its name, lookup key and numbers, and never
  asks for `READ_CONTACTS`.
- **App list:** `PackageManager` launcher apps (needs a `<queries>` for `MAIN/LAUNCHER`; no
  `QUERY_ALL_PACKAGES`), sorted by the ones that posted since access was given.
- **Nothing leaves the phone** but the light request. Notification text is never stored or
  logged; only the package name and a match.

### Shared notification-access moment (with Album colors)

Both features need **Notification access** (a special access Android grants only in its own
Settings page, never through a dialog). Whichever feature asks first shows the moment; the
other then finds it granted.

```
           ◍  (a jewel with a soft ring pulsing once)

     Let Glim see notifications

     Glim reads them on this phone to
     · glow a light when someone you pick writes
     · color the room with the album playing      (Album colors)

     Nothing is kept or sent anywhere. Only the light changes.

     [ Open Android settings ]          Not now
     Can't switch it on?  ›   (restricted settings help)
```

- "Open Android settings" → `Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` with
  Glim's component (Android 11+), so the user lands on Glim's own switch.
- On return (`AppState` active), check `NotificationManagerCompat.getEnabledListenerPackages`;
  granted → the sheet closes on a small "Glim sees notifications" confirmation and the feature
  that asked carries on.
- "Can't switch it on?": Android 13+ greys out notification access for apps installed from
  a downloaded APK file ("Restricted setting"). The help line says: App info → ⋮ → Allow
  restricted settings. Glim installed with `adb install` is not restricted.
- Settings → Your home → **Notifications** row shows the state and links to the same page.

Sibling note for the Album colors session is in the shared notes folder
(`small-ideas-shared-notification-access.md`).

## What was verified (2026-11-14, real bridge, local API)

- Every color light here lists `signaling.signal_values`:
  `no_signal, on_off, on_off_color, alternating`. Both smart plugs have **no** `signaling`,
  and a `PUT` with one is refused (`invalid attribute value (.signaling)`).
- `on_off_color` with one xy, 2000 ms, on Bureau (Hue Go, off): accepted;
  `signaling.status` reports `{signal, estimated_end, colors}` while it runs and disappears
  after; the light is still **off** with its own color and level after. On the same light
  **on** (40%, 370 mirek): after the signal it was back at 40%, 370 mirek. No restore needed.
- 500 ms accepted. `alternating` with 2 colors accepted. 3 colors refused (`maxItems 2`).
- `alert: {action: breathe}` accepted on an off light (one breath, no color choice).
- Every room's and zone's `grouped_light` carries `signaling` except Terrasse (plug only).
- **Not seen:** the blink itself (no one looking at the lamp). Before building, look at A vs B
  on a real lamp: the maintainer runs the "Try it" in a dev build, or the curl in Build step 1.

## Limits

- Android only (iOS has no notification listener).
- Contact matching is by name and number as the app shows it: a nickname in WhatsApp that
  differs from the contact card won't match (the rule can then be "contact in an app" by
  name as typed).
- Apps that hide content on the lock screen still post the sender in `EXTRA_TITLE` to listeners
  in most cases; Signal with "No name or content" posts nothing usable: app rules only.
- `signaling` blinks the light at its own brightness; the pulse's level can't be set.
- Gradient lights blink whole (no per-segment pulse).

## Open questions

1. A, B or C for the pulse (after seeing it on a lamp)?
2. Rules in Rituals (recommended) or Settings?
3. Should calls (category `call`) ring a light for as long as the phone rings (`on_off_color`
   with a 20 s duration, stopped with `no_signal` when answered)? Not in v1 unless asked.

## Build steps

1. Look: `PUT light/<Bureau>` with `on_off_color` 1000 ms red, then `alert breathe`, then
   `alternating`; pick the pulse.
2. `GlimListener.kt` (service + manifest `BIND_NOTIFICATION_LISTENER_SERVICE`), filters,
   matching, `FastRoute` send; rules from `huelab_fast`.
3. JS: `src/lib/rituals/glow.ts` (rules per bridge, sync to `huelab_fast`), notification
   access helpers (shared with Album colors), contact picker and app list in the module.
4. UI: Glows card group + `GlowSheet.tsx` in `src/ui/rituals/`, the shared access moment
   `src/ui/NotificationAccess.tsx`, the Settings row.
5. Test on the real lights: a message from a picked contact, a burst, quiet hours, DND,
   away from home (no glow), a plug target refused in the picker.
