# Your matters: analyse a document, see everything at a glance

Two things lawyers ask for most: "what is in this document?" and "where are we on this matter?". OpenLex answers both from your own computer, and every answer says where it came from.

## Analysing a document

```bash
openlex analyse contract.docx --matter <id>
```

(In the terminal app or Word, type `/analyse` instead. Without `--matter`, the report goes into a general folder.)

OpenLex reads the whole document and writes a report in the document's own language:

- **At a glance**: what the document is, the parties, its purpose
- **Risks**: rated high, medium or low, each with one line on why it matters and a suggested fix
- **Deadlines and dates**: the next one first, with how important each is
- **Who has to do what**: the obligations of each party
- **Key terms**: price, term, caps and similar, as written
- **Notable and missing clauses**: what stands out, and what seems to be missing (please check those yourself)

How you can trust it:

- **Every finding quotes the document word for word**, with where it is ("§ 9 Liability · page 2"). If the AI quotes something that is not in the document, the finding is removed. The report says how many were removed.
- **Law is looked up only for high and medium risks.** OpenLex looks it up in the law sources connected in `/law` (for example RIS for Austrian law, EUR-Lex for EU law), online per question, but only if this matter's [data rules](client-data-rules.md) allow web access. In "Work fully offline" mode it uses the copies kept on your computer instead.
- **A second pass checks every suggested fix.** A fix can be kept, corrected, or removed. When it is removed, the report says so and the decision is yours.
- A dated deadline must match the date written in its quote. Otherwise it is shown as a period (for example "14 days after notice").

You get three files in the matter folder:

| File | For |
|---|---|
| `analysis-contract.docx` | The Word report, with locations and law sources, to read or send on |
| `analysis-contract.md` | The same report as plain text |
| `analysis-contract.json` | The same data for other programs (and for the matter overview below) |

Running it again on the same document replaces the report. OpenLex keeps the earlier version in the workspace history.

## Your matter at a glance

```bash
openlex matters show <id>
```

This shows everything OpenLex already knows about the matter, sorted into cards. It doesn't ask the AI anything, so it is instant and works offline:

| Card | What is on it |
|---|---|
| Summary | The matter, its data rules, and one line per analysed document |
| Documents | The matter's folders, linked Word documents, analysed files |
| Key findings and risks | From analyses and the latest review, high risks first |
| Deadlines | Overdue checklist items first, then upcoming dates (next first), then periods |
| Decisions and approvals | Plans you approved, your decisions at checkpoints, checklist items marked done |
| Open questions | Checkpoints waiting for you, blocked items, clauses that seem to be missing, fixes that did not pass the second check |
| Notes | Facts OpenLex noted while working, and the bullet points in `notes.md` in the matter folder |
| Sources used | Law found for risks, web pages and files saved into the matter |
| Recent activity | Analyses, reviews, conversations, and how often the AI or the web was used (the usage log never contains content) |

Every line ends with where it came from and when, for example *from Analysis of supply.docx · 20 Oct 2026*.

### Find something again

```bash
openlex recall "liability cap" --matter <id>
```

Searches everything stored for the matter: findings, deadlines, notes, checklists, plans, grid answers, earlier conversations. The best matches come first, and newer ones rank above older ones. Add `--summary` for a short answer written by the AI from those results only. It follows the matter's data rules, so a privileged matter never sends them to a cloud model.

### A memo for the file

```bash
openlex matters export <id> --format docx     # or pdf, md
```

Writes `matter-memo-<date>.docx` into the matter folder: the same cards, ready to print, file or send to a colleague.
