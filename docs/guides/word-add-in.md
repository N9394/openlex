# Word add-in

OpenLex in Word reviews contracts clause by clause and puts its proposals into the document as tracked changes and comments. It also answers questions about the open document and the law. Everything happens in one narrow pane next to your document.

## Install

1. Download the installer for macOS (`.pkg`) or Windows (`.exe`) from the [download page](https://openlex.pinemarshlands.com/download).
2. Run it. It installs the local engine, starts it when you log in, and adds OpenLex to Word. It also sets up the certificate Word needs to talk to the engine on your computer.
3. Restart Word. **OpenLex** appears on the **Home** tab: click **OpenLex Chat** to open the pane.

If the button doesn't appear, go to **Insert → My Add-ins → Shared Folder** (Windows) or **Insert → Add-ins → My Add-ins** (Mac) and pick OpenLex.

> The current installers still use the old name LexVault and ask you to sign in on first start. The next release removes both.

## What the pane shows, and why

The pane keeps only what you need in view. Everything else is one search away.

```
┌──────────────────────────────────────┐
│ OpenLex  [Acme v Beta        ▾] 🔓 ☰ │  the matter this document belongs to · menu
│ (AI: this computer) (✓ This matter   │  where the AI runs · the matter's rule
│  stays on this computer)             │
│                                      │
│   Ask about this document, or press  │  the conversation
│   Review this contract.              │
│                                      │
├──────────────────────────────────────┤
│ Your data: ✓ Stayed on this computer │  where your data went (always visible)
│ [Ask about this document…   ] [Send] │  the question box
│ [Review this contract] [Options]  ↩  │  the main action · undo the last change
└──────────────────────────────────────┘
```

- **The matter** at the top. Pick the matter the document belongs to: its client-data rule, its folder and its notes then apply. The line underneath says where the AI runs (*AI: this computer* or, for example, *AI: Claude (Anthropic)*) and what the matter allows.
- **The conversation.** Your questions, OpenLex's answers, and one card per piece of work (a review, an analysis).
- **Your data** — the line above the question box is always there and always says where your data went for the last request, with a symbol and in words (never only a colour):
  - `✓ Stayed on this computer`
  - `! Sent to Claude (Anthropic, EU) — names hidden · 2 times`
  - `! Looked up online: RIS` (only search words or web addresses leave the computer)
  Hover over it for more detail. **see the AI record** at its end opens the [AI record](ai-record.md).
- **The question box** and **one main action, Review this contract.** Everything else is in the menu.
- **☰ What can I do here?** (or **Ctrl+K** / **⌘K**) opens one searchable menu: compare with another version, answer the comments, list the obligations, check cross-references, the document outline, proposed changes, work across the matter (review every document, chronology, translate, compare), your firm's clauses, a new matter, and the settings. Type a few words ("translate", "timeline", "which AI") and press Enter. Your firm can switch entries off (see [HARNESS.md](../HARNESS.md#features)).
- **The AI record.** ☰ → *AI record for this matter* (or *AI record — all matters*) opens one view: a summary line (*12 requests · 3 sent to Claude (Anthropic, EU), names hidden · 2 online lookups · 1 permission denied · record intact ✓*), a date range and *Only what left this computer*, the entries (click one for its details), and **Export PDF**, **Export CSV** and **Check the record**. It never contains document text, prompts or answers. See [The AI record](ai-record.md).
- **One hint at a time.** Under the question box OpenLex sometimes offers one thing that fits what you are doing — for example, when you select text: *With the selected text: Explain · Rewrite for the client · Check*, or *Your firm has instructions for this: “NDA review”*. Close it with ✕ and it stays away.

### While OpenLex works

A short list shows what it is doing, in plain words — at most three lines, the current one in bold:

```
Working… 12 s so far
  … 2 earlier steps
✓ Reading clause 4 (Liability)
✓ Searching Austrian law: “Haftung Höchstbetrag”
▸ Writing the answer
```

When it is done, the list folds into one line — `✓ Done in 18 s · 6 steps — what it did` — which you can open to see every step (and its working notes).

**Stop** (the Send button turns into Stop, or press Esc in the question box) ends the request at once. What was written so far stays, and OpenLex says what it kept: *Stopped by you. Kept: the answer so far (84 words), 2 law sections it found. Nothing more is sent or saved.*

What you type is never lost: a draft survives closing the pane, and if a question could not be sent it goes back into the question box.

### Based on

Under each answer, small numbered markers show what it is based on: `Based on ① ② ③`. Click a number to see the passage. For a law section, **Read the full text** shows the whole section from the law collection on your computer; for a part of your document, **Show it in the document** selects it in Word.

### When OpenLex asks first

Some steps need your permission (saving a file, opening a web page, using a connected system). OpenLex asks one question with the verb, and waits:

```
┌──────────────────────────────────────┐
│ May OpenLex save obligations.csv in  │
│ Acme/?                               │
│ It would save a file in your files   │
│ folder. Nothing happens until you    │
│ choose.                              │
│ ▸ What exactly                       │
│ [Allow once] [Don't allow]           │
│ [Always for this matter] [Always]    │
└──────────────────────────────────────┘
```

**Allow once** has the focus, so Enter allows just this one time; **Esc** means *Don't allow*. "Always" is never pre-selected. No answer within a few minutes counts as *Don't allow*.

### Proposed changes

Every proposed change shows the current and the proposed wording, and whether it was checked: `checked against ABGB § 933 ✓`, or `! could not be verified — review carefully`. Changes always go into the document as **tracked changes** (accept or reject them in Word's **Review** tab), and **↩** next to the main action undoes the last change OpenLex made.

If OpenLex cannot find the words a change is about (for example because you edited the document in the meantime), it says so and offers **Insert as comment instead** — on the clause heading, or where your cursor is.

## Reviewing a contract, step by step

1. Open the contract in Word and the OpenLex pane. Pick the matter at the top (or start a new one from the menu).
2. Press **Options** next to **Review this contract** if you want to set:
   - **Acting for** — whose side you are on (supplier, customer, landlord, tenant, employer, …). OpenLex then flags what is unfavourable to that side and drafts wording that protects them.
   - **Check against** — one of your firm's checklists (playbooks), or none for a general review.
   - **Pay particular attention to** — liability, termination, payment, data protection, …
   OpenLex remembers your side for next time.
3. Press **Review this contract** (or **Start the review**). One card shows the progress: `Clause 4 of 18 · clause 4 (Liability) · about 2 minutes left`.
4. Each finding goes straight into the document: as a tracked change (when OpenLex proposes new wording) and as a comment with the reason, the legal basis and whether it was checked. You can switch either off in Settings → Proposed changes.
5. When it finishes, the card starts with one line — `2 high risks, 5 medium, 1 low` — and how it went: `Reviewed 18 clauses in 4 min.` **Show the findings** lists each one with its clause, reason, check and where it is in the document, with **Show in the document**, **Accept** and **Reject**. Findings OpenLex could not mark in the document are listed first with **Insert as comment instead**.
6. **Save the review as Word** or **Save as PDF** writes a summary (risks by severity, what you accepted and rejected, the legal basis of each finding) into the matter's folder in your files folder.

You can press **Stop** at any time: everything found so far stays in the document and the card says how far the review got.

## Settings in plain words

Open them from the menu (**Settings: which AI**, **Settings: where client data may go**, **All settings**):

- **Which AI** — the AI on this computer, or an AI service with your own key. Model names and addresses are under *Technical details*.
- **Where client data may go** — only this computer, or also the AI services and online sources you tick; *Only services in the EU*; *Hide names and identifiers from AI services*.
- **Firm library** — folders of precedents OpenLex may search.
- **Proposed changes** — comments, tracked changes, and whether to put changes in without asking each time.
- **Appearance** — the pane follows Word's light or dark theme (*Match Word*), or pick one. Animations are off when your system asks for reduced motion.
- **Your files folder** — where reviews, checklists and calendars are saved, one folder per matter.

## Keyboard

- **Ctrl+K / ⌘K** — open or close the menu; arrows choose, Enter opens, Esc closes.
- **Enter** sends, **Shift+Enter** adds a line; **/** lists your firm's instructions; **Esc** in the question box stops the current request.
- In a permission card: **Enter** = Allow once, **Esc** = Don't allow.
- **Esc** in a settings or list view goes back to the conversation.

Every control is reachable with Tab and shows a visible focus ring; screen readers hear the current step, the answer when it is complete, and permission questions.

## Using it together with the terminal app and the desktop app

All three share one engine on your computer, so a matter created in one is visible in the others. When the desktop app is open, the pane offers **↗ Continue in the desktop app**.

## For developers

The pane is plain HTML/CSS/JS served by the engine (`add-in/taskpane.*`). Its logic lives in small modules under `add-in/lib/` (activity, data line, sources, review, errors, menu, permission card, theme, hint slot, matter) with no Office.js in them, tested in node: `cd sidecar && node --test test/addin_pane.test.js`. The sentences on `step` events come from the engine (`plain`, see [LOCAL_API.md](../LOCAL_API.md)). A manual test script for Word is in [add-in/TESTING.md](../../add-in/TESTING.md).
