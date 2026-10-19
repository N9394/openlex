# Playbooks

A playbook is a review checklist as a plain JSON file. Firms keep them under version control, share them and adapt them. OpenLex runs a playbook over every document in a matter (**Whole matter → Review documents**, or `openlex review --playbook nda`). An answer is only kept if it quotes the document verbatim.

```json
{
  "title": "NDA / confidentiality agreement",
  "version": "1.0",
  "checks": [
    { "id": "term", "question": "How long do the confidentiality obligations last?", "severity": "high" }
  ]
}
```

- `id` must be unique within the playbook. It is used in the CSV report.
- `question` is asked of every document. Write it as a lawyer would ask a junior: concrete, and naming the statute where it helps.
- `severity` (`high` / `medium` / `low`) is the default risk for a finding. The model may rate a specific finding differently.

**Where they come from:** the playbooks in this folder ship with OpenLex. A firm's own playbooks go into the workspace folder `playbooks/` (by default `~/LexVault/playbooks/`). A firm playbook with the same file name replaces the bundled one.

The bundled playbooks are starting points written for Austrian and EU practice. They are not legal advice, and they need checking against your own standards before use.
