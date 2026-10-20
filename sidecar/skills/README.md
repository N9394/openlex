# Bundled skills

Starter skills that ship with OpenLex. Each folder holds one `SKILL.md`: frontmatter (`name`, `title`, `description`, `triggers`, optional `tools` and `output`) and the instructions the agent follows.

- Run one by starting a message with `/<name>`, for example `/nda-review we act for the discloser`.
- Without a `/name`, OpenLex suggests the best-matching skill (via the decision model when one is configured, else by keywords).
- A firm overrides or extends these with its own files in the workspace `skills/` folder (`skills/<name>/SKILL.md`). Same name = the firm's version wins.
- Draft new ones from a plain-language request: `POST /api/skills/draft` or `openlex skills draft "…"`; review the draft, then save it.
