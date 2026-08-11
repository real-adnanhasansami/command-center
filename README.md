# Command Center — Personal Productivity Hub

Offline-first PWA: fixed daily/weekly/monthly Activities, a To-Do board,
Weekly/Monthly Plans with deadlines, a Calendar, a free-form Routine page,
Habit streaks (daily/weekly/monthly), Sticky Notes, a Vision Board, a
rich-text Journal, gamified Levels, Challenge Mode (streaks & daily
deadlines), a Notices/changelog board, a completion History log, and a
per-task countdown timer with sound + browser notification.

## Run it locally (required — PWAs don't work from a double-clicked file)

```bash
cd command-center
python3 -m http.server 8080
```
Then open **http://localhost:8080**.

No Python? With Node: `npx serve .`

## Install as a desktop app

Once it's open in the browser, click the install icon (⊕) in Chrome/Edge's
address bar, or use the browser menu → "Install Command Center…". After the
first load the service worker caches everything, so it works fully offline
afterward — close the tab, disconnect, reopen any time.

## What's where

| Tab | What it's for |
|---|---|
| **Dashboard** | Today's completion %, planned vs. actual time, habit overview, upcoming deadlines, this week's plan |
| **Activities** | Fixed routines — pick Daily / Weekly / Monthly from the dropdown (e.g. Daily → read a book, Weekly → training, Monthly → haircut). Not on the Calendar. |
| **To-Do** | Kanban board (To-Do / In Progress / Done) for multi-step work, with an optional deadline per card and a one-click ✓ to mark complete |
| **Weekly Plan** / **Monthly Plan** | What you're doing next week / month — text + date + time + optional deadline. Feeds the Calendar. |
| **Upcoming** | A general future task list — priority, countdown timer |
| **Calendar** | Auto-populated from To-Do deadlines, Weekly/Monthly Plan dates, and Level deadlines — click a day to see what's on it |
| **Routine** | A free-text page for writing out your daily routine |
| **Habits** | Daily / Weekly / Monthly streak tracking — frequency is fixed once you create a habit |
| **Sticky Notes** | Draggable colored notes |
| **Vision Board** | Upload images, drag them anywhere, resize from the corner, add a caption — your visual goals board |
| **Journal** | Rich-text (Bold/Underline/Italic/bullets) dated entries — rename the section, delete old entries |
| **Levels** | Gamified sequential tasks — see "Levels" below |
| **Challenges** | Streak & daily-deadline challenges — see "Challenge Mode" below |
| **Updates** | Your own notice board (editable) + a built-in changelog of what's new in the app |
| **History** | Every completed item from every section, grouped — click a group to expand it. Delete individual entries, clear it all, or lock sections from "Erase All" |

You can also **drag tab names in the top bar** to reorder the whole navigation.

## Levels (gamified tasks)

Add a level with either an hours countdown, or a specific date & time
deadline. Only the first incomplete level is active — later ones stay
locked (can't be checked off) until you finish the one before it. If you
miss a level's deadline, you get a grace period equal to **half** the
original deadline. Miss that too, and **all levels lock for 24 hours** as
a penalty before you can try again. Level deadlines with a specific date
also show up on the Calendar.

## Challenge Mode

Two ways to run a challenge, both trackable in one place:

- **Duration challenge** — pick 10, 20, 30, or 365 days, or set custom
  start/end date+times. Tick "Mark Today Done" once a day; a day-by-day
  strip shows green (done) / red (missed) / outlined (today, pending).
  Miss a day and it's recorded as missed and your current streak resets
  — you can still keep going the next day.
- **Daily deadline challenge** — set a specific time (e.g. `07:00`). You
  must tick it before that time each day or it's marked missed for that
  day. Great for "must be done before X" habits. Can be combined with a
  duration too, or left ongoing.

Each challenge card shows the current streak, your best streak, a
progress bar (for dated challenges), and a countdown to either the next
deadline or the end date.

## ☁️ Cloud Sync (optional)

Click the 👤 button in the top bar to sign in with Google. Once signed in,
everything — Activities, To-Do, Plans, Habits, Journal, Levels, Challenges,
Notices, History, settings — syncs in **real time** across every device
you sign into with the same Google account. No sign-in, no account needed
at all: the app works exactly as it always has, fully local, if you never
touch that button.

**Vision Board is the one exception** — it stays device-local and does
*not* sync. Images are simply too large for the free Firestore plan's
1MB-per-document limit; syncing them properly needs real file storage
(e.g. Firebase Storage), which isn't wired up yet.

**First sign-in on a new device:** if that device already has its own
data *and* the account already has cloud data, you'll get a prompt asking
which to keep — nothing is ever silently overwritten. If only one side
has data, it's used automatically (no prompt needed).

This is powered by Firebase (Google's backend-as-a-service) — see
`js/firebase-config.js` for the project credentials (safe to be public;
access control is enforced by `firestore.rules`, not by hiding this) and
`firestore.rules` for the actual security rule (each account can only
ever read/write its own data — copy that file's contents into your
Firebase Console → Firestore Database → Rules tab → Publish).

## Vision Board

Click **＋ Add Image** to pick one or more photos — they're placed on a
free-form board you can drag around and resize (bottom-right corner
handle), with an optional caption under each. Images are automatically
downscaled before saving to keep things reasonably light, but this is
still local browser storage, so a very large number of high-res images
can hit the browser's storage limit (a few MB, typically). Use the JSON
export regularly if your board gets big.

## Timer

Every Activities/Upcoming task has a **countdown timer**: set the minutes
on the task (any length), hit ▶, and it counts down. When it hits zero you
get a sound (built-in, no file needed) and a browser notification (first
use will prompt for notification permission — allow it if you want the
popup, the sound plays either way). Clicking ▶ again on a running timer
stops it early and banks the partial time.

## Wrap Up Day

The "🧹 Wrap Up Day" button opens a designed, printable report (completion
ring, planned vs. actual time, completed/carried-over items, today's
journal entry with its original formatting, sticky notes) for your
**Daily Activities**, and automatically opens the print dialog — choose
**"Save as PDF"** as the destination (there's also a manual "🖨 Save as
PDF" button on the page itself if the dialog doesn't open automatically,
e.g. if pop-ups were blocked). After that, it clears completed items and
resets planned/actual time so it's ready for tomorrow.

## History

Every time you complete something — an Activities item, a Weekly/Monthly
Plan item, a To-Do card, a Level, or a Challenge day — it's logged to
History, grouped by which section it came from (repeatedly ticking and
unticking the same item never creates duplicates — it's updated in
place). Click a group's name to expand it. Each entry has its own ✕ to
delete just that one, or use **🗑 Clear All History** to wipe the whole
log (a backup downloads automatically first).

### 🔒 Erase Locks

Also on the History tab: a lock checkbox per section (Activities, To-Do,
Journal, Vision Board, Challenges, etc.). Lock a section and the top-bar
**⏻ Erase All** button will leave it completely untouched, even though
everything else gets wiped. Useful if you want a fresh start on most of
the app but want to keep, say, your Journal or Vision Board intact.

## Backups (JSON) & moving between devices

Use **⬇ (export)** in the top bar to download your entire dataset as a
`.json` file, and **⬆ (import)** to load one back in — this is how you move
your data to another device or browser (there's no cloud sync; it's all
local by design). Importing replaces everything currently on the device
you're importing into.

## Erase All (⏻)

The small red **⏻** button in the top-right corner wipes data — every
task, plan, note, journal entry, habit, level, vision board image, and
challenge — **except** any sections you've locked on the History tab (see
above). Before it wipes anything, it **automatically downloads a safety
backup** so you have a copy even if you didn't mean to reset. There's
still no undo beyond that backup, so keep the downloaded file if there's
anything you want to restore later.

## Data & backups

Everything lives in your browser's `localStorage`, scoped to whatever
origin you serve it from (e.g. `localhost:8080`) — nothing is sent
anywhere. Clearing that site's browser data will erase it, since there's
no account or cloud sync by design. Use the JSON export above for real
backups or to move to another device.

**Pushing updates from GitHub never touches your data.** Your tasks,
journal, etc. live in `localStorage`, completely separate from the app's
code files that the service worker caches. When you push a new version
to GitHub Pages (or wherever you host it), each installed device will
detect the new files (a toast says "Updated to the latest version —
reload to apply"), reload the app shell, and your data underneath is
exactly as it was. If you're maintaining this yourself: **bump
`CACHE_VERSION` in `sw.js`** on every release you push — that string is
what tells already-installed devices to actually fetch the new files
instead of quietly continuing to serve the old cached ones forever.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — all views live in one page |
| `css/styles.css` | Theme (dark + light), layout, all component styles |
| `js/storage.js` | localStorage persistence + migration from older versions + Firebase cloud sync |
| `js/app.js` | All application logic |
| `js/firebase-config.js` | Your Firebase project credentials (safe to be public) |
| `firestore.rules` | Security rules to paste into the Firebase Console (Firestore → Rules) |
| `manifest.json` / `sw.js` / `icons/` | PWA install + offline caching |

Everything is plain HTML/CSS/JS, no build step, no dependencies — open any
file in an editor and change away. Colors and fonts are CSS variables at
the top of `css/styles.css` under `:root` and `[data-theme="light"]`.
