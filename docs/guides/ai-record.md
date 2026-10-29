# The AI record: show your client or DPO what the AI did

A client, your data protection officer or a bar auditor may ask: *What did the AI do with our matter? Which service saw our documents, and where? Who allowed what?* The **AI record** answers that, for one matter or for all of them, without showing any client content.

## Where to find it

- **Word:** ☰ *What can I do here?* (Ctrl+K / ⌘K) → **AI record for this matter** or **AI record — all matters**. Or click **see the AI record** on the *Your data* line, or **Open the AI record** in the matter overview. Esc or *← Back to the conversation* returns.
- **Terminal app:** `/record` in a conversation (`/record all` for every matter), Ctrl+K, or **AI record** in the matter menu.
- **Command line:** `openlex record --matter ID` (see below).

At the top is one line that sums it up, for example:

```
12 requests · 3 sent to Claude (Anthropic, EU), names hidden · 2 online lookups · 1 permission denied · record intact ✓
```

Below it, every entry, newest first. Open one to see the details:

```
! 29 Oct 2026 14:02 · Question: “Can the seller limit liability?” (Word)
    Asked in: Word
    Matter: Alpine share deal
    AI: Claude (Anthropic, EU) — sent outside this computer, names hidden · 3 calls
    Looked up online: RIS (Austria's federal law database) — only search words or a web address were sent
    Permission to save a file: denied — decided by you
    Result: Answered, 1 proposed change
    Took 34 s
```

`!` marks entries where something left this computer; `✓` means everything stayed here; `✗` means the request did not finish. You can narrow the list to a date range and to **only what left this computer**.

## What is recorded

- **Each request:** when, from which window (Word, the terminal app, the command line), the short title of what was asked (the first words of the question, or the name of the checklist), the result (answered, the number of proposed changes, the names of files saved) and how long it took.
- **Each AI call:** which AI service and where it ran — on this computer, or an online service and its region (for example *Claude (Anthropic, EU)*) — and whether client names were hidden before sending. AI calls are grouped under the request they belong to.
- **Each online lookup:** only the website or database (for example RIS, EUR-Lex, or a web address's host name).
- **Each permission decision:** what OpenLex wanted to do (save a file, open a web page …), whether it was allowed, and who decided: you, your firm's rule, your saved rule, or nobody answered in time. Routine steps the standard settings allow (reading, searching) are counted, not listed.
- **What your client-data rule stopped:** for example a call to an online AI service the matter does not allow.

## What is never recorded

The text of documents, the full questions as sent to the AI, the AI's answers, the instructions given to the AI, file contents and search words. OpenLex does not put them in the record at all, so they cannot appear in an export either. (OpenLex's test suite checks this with made-up secret text.)

The short title of a request is the start of the question as you typed it. If even that should not be shown — for example to a third party — export with the titles left out (`titles: false` in the [local API](../LOCAL_API.md#ai-record), see below).

## Checking that nothing was changed

Every line of the record carries a fingerprint of the line before it (SHA-256). If a line is changed, removed or moved, **Check the record** (Word), `v` (terminal app) or `openlex record --verify` says so and names the first line where the chain breaks:

```
✗ Record changed: Audit log (AI calls, online lookups, permissions) — Line 7 was changed after it was written.
```

When everything is in order: *Record intact: all 3 logs checked, no line changed, removed or moved.*, with a **fingerprint** of the whole record (for example `3f2a 9c1d 77b0 e412 …`).

Be clear about what this does: it **detects** changes; it does not **prevent** them. The record is kept as files on this computer, and someone with access to them could rewrite every line and every fingerprint. That is why an export carries the fingerprint: keep the export (or send it to the client), and you can show later that the record has not changed since. A signed, time-stamped seal may be added in a later version.

Lines written before this feature existed are sealed once, the first time OpenLex starts with it: they are covered by one fingerprint of their own, so changing them afterwards also shows.

## Exporting

**Export PDF** / **Export CSV** (Word), `p` / `c` (terminal app), or `openlex record --export pdf|csv|md`. The file goes into the matter's folder (or a `records` folder in your files folder for all matters) and contains:

1. *What this record shows and what it never contains* — a one-page explanation for the reader,
2. the summary,
3. the table of entries (when, window, matter, what was asked, AI service, where it ran, region, client names hidden, number of AI calls, online lookups, permissions, results, files saved, seconds),
4. the result of the check and the fingerprint.

## Keeping the record shorter

By default OpenLex keeps the whole record. To keep only the last months, run `openlex record --keep-months 24` (or `--keep-months all` to keep everything again). Older entries are removed once a day; each log then starts with a note saying how many entries were removed and from when to when, so the removal itself stays visible and the check still passes. OpenLex refuses to remove anything from a log whose check fails: export it first.

## Command line

```
openlex record [--matter ID] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--left]
openlex record --verify
openlex record --export pdf|csv|md [--matter ID] [--from …] [--to …] [--left]
openlex record --keep-months N|all
```

`--left` shows only what left this computer; `--json` prints the raw answer for scripts. `--verify` ends with exit code 1 when the record was changed.
