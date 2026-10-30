# Security policy

OpenLex handles confidential client data, so we take security reports seriously and answer them quickly. Thank you for helping keep its users safe.

> **Status:** OpenLex is an early release and has not yet been independently audited.

## How to report a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.** Report it privately through one of these channels:

1. **GitHub private vulnerability reporting (preferred):** go to the repository's [Security tab](https://github.com/N9394/openlex/security) and choose **Report a vulnerability**. Only the maintainers can see the report.
2. **E-mail:** nicolas.jansa@outlook.com

Please include:

- the affected version (`openlex --version` or the release name) and operating system;
- what an attacker can do, and the steps or a proof of concept to reproduce it;
- whether you have shared the issue with anyone else.

You may write in English or German. If you want to encrypt your report, say so in a first message and we will arrange it.

## What happens next

These are **targets**, counted from the moment we have confirmed the report (reproduced it, or agreed it is a vulnerability). Issues in third-party dependencies may take longer, because they depend on the upstream project's fix; we will tell you when that is the case and ship a mitigation where we can.

| Step | Target |
|---|---|
| Acknowledgement of your report | within **72 hours** |
| First assessment (confirmed or not, severity) | as soon as possible, normally within 5 business days |
| **Critical** (e.g. client data leaves the machine against the data policy, remote code execution, signature or update bypass) | fix or mitigation within **72 hours** |
| **High** | fix within **14 days** |
| **Medium / Low** | fix in the **next release** |

Severity follows [CVSS v3.1/v4](https://www.first.org/cvss/) as a guide, adjusted for what matters to a law firm: anything that can expose client data is treated as at least High.

We will keep you informed while we work on it, credit you in the release notes and the advisory if you wish, and publish a [GitHub security advisory](https://github.com/N9394/openlex/security/advisories) (with a CVE where appropriate) once a fix is available. Please give us the time above to ship a fix before you disclose the issue publicly; we are happy to agree a disclosure date with you.

**Security fixes are always free.** They are released for everyone, in the open-source version, and never require a paid service or contract.

## Supported versions

Security fixes are made for the latest minor release. Please update to it before reporting, if you can.

| Version | Supported |
|---|---|
| 0.2.x (latest) | yes |
| older than 0.2 | no |

## Scope

In scope: everything in this repository, in particular

- the engine and CLI (`sidecar/`), including the local API, the data policy and routing to model providers, pseudonymisation, the audit log, permissions and the workspace/folder boundaries, MCP client and server, and the update and download code;
- the Word and Outlook add-in (`add-in/`);
- the desktop app (`desktop/`), including the legacy desktop server (`desktop/server/`, `desktop/server-fixes/`);
- the install scripts (`scripts/install.sh`, `scripts/install.ps1`), the release workflow and the release artifacts (signatures, attestations, checksums, SBOM).

Examples of what we especially want to hear about: client data reaching a cloud model, the web or a connector when the matter's data policy forbids it; privileged matters leaving the machine; escaping the workspace or the working folder; a local service reachable from the network; prompt injection from a document or web page that makes OpenLex act without the lawyer's permission; anything that defeats the checksum, signature or attestation checks.

Out of scope:

- the quality or correctness of legal answers (please open a normal issue);
- vulnerabilities in third-party model providers, law databases or services themselves (report them to the provider; tell us if OpenLex makes them worse);
- attacks that need an already compromised machine or administrator access to it;
- commercial extensions and services, which are not part of this repository;
- denial of service by sending huge amounts of traffic, social engineering, and physical attacks.

## Prompt injection

OpenLex reads untrusted text all the time: client documents, the other side's contracts, web pages, law-source results, connector (MCP) results, files and e-mails. Any of them can carry instructions aimed at the model. **These measures reduce the risk; they cannot eliminate it.** No current model reliably ignores instructions in its input. The permission prompt is the main line of defence, so keep "always allow" rules narrow (a host or a path, not a whole tool). Lawyer-facing summary: [docs/guides/hidden-instructions.md](docs/guides/hidden-instructions.md).

What is in place:

- **Data, not instructions.** The open document, pre-read sections and every outside tool result reach the model inside marked blocks (`<<<UNTRUSTED <tag> source="…">>>` … `<<<END UNTRUSTED <tag>>>>`). Marker look-alikes in the content are neutralised and the tag is random per engine process, so content cannot close its block. A short stable prompt rule (block `injection`, `sidecar/src/prompts.js`) says such blocks are data and that their content and client names never go into links, images, addresses or tool arguments unless the lawyer asked. The second pass (judge) gets its sources marked the same way. (`sidecar/src/untrusted.js`)
- **Tools are gated after reading.** Once untrusted text entered a run (the open document counts from the start), these are asked even when a general "always allow" rule exists: `web_fetch`, `web_save`, `download_to_matter` to a host the lawyer did not name in the conversation; file writes outside the matter's folder or the working folder; `run_bash`; `enable_law_source`; `request_law_source_key`; connector tools the server does not mark read-only. Narrow rules the lawyer created (`web_fetch:eur-lex.europa.eu`, `write_file:Acme/**`) still count, except for `run_bash`, `enable_law_source` and `request_law_source_key`. The question says that the request came up while reading a document or page. Deny rules and the working-folder sandbox apply first, as before.
- **Outbound arguments are checked.** Before a web tool, a law-source or RIS/EUR-Lex search, a connected source or a connector is called, its arguments are scanned for the matter's client and listed parties (unless the lawyer used the name), pseudonymisation placeholders, ≥ 200 characters copied from what was read, and long base64/hex strings. A hit is asked with a warning, without an "always" choice; `--allow` and `--yes` do not skip it, and a non-interactive run refuses it. The audit log and the AI record name the kind of finding, never the content.
- **Nothing loads by itself.** Answers in the desktop app, the Word pane and the Outlook pane never render remote images (shown as "[image: host]"); raw HTML is not rendered; links open in the browser only on a click, show the full address on hover, and ask first when the address could carry data. The built desktop page and the Office panes carry a Content-Security-Policy without remote image, script or request sources. The Electron window cancels every request to a non-local address, stays on the app page, denies new windows and opens only `http(s)`/`mailto` links externally.
- **Placeholders stay placeholders inside addresses.** With "hide names" on, placeholders are restored in plain text only, never inside a web address, link target or image address in an answer or a tool call (`sidecar/src/redact.js`).
- **Red-team tests** (`sidecar/test/injection.test.js`, fixtures in `sidecar/test/fixtures/injection/`, English and German) run the real agent with a fake model that obeys the injected instructions and check that the gates hold.

Known limits:

- An injection can still steer what the model *writes*: a slanted summary, a missed clause, a wrong recommendation, a link the lawyer then clicks. Answers need the same review as any draft.
- With the lawyer's "Allow once" an injected request goes through; the prompt can only show what is asked and why it looks suspicious.
- The outbound check is heuristic: paraphrased or short fragments, names not listed on the matter, and data encoded in ways it does not recognise can pass. Hosts the lawyer named in the conversation are trusted for web tools.
- Features that call the model without tools (analysis, review, drafting, overview, monitors, panels) pass document text without the markers. They cannot act, but their output can be influenced.
- The Word and Outlook panes load Office.js from Microsoft, which the Content-Security-Policy has to allow.
- `--yes` (approve every question in a scripted run) approves gated requests that carry no finding. Do not use it on untrusted documents.

Reports of an injection that makes OpenLex act, or send data, without the lawyer's permission are in scope (see above) and treated as at least High.

## Safe harbour

We will not take legal action against anyone who reports a vulnerability in good faith under this policy, avoids harming users and their data (use your own test data, never real client files), and gives us reasonable time to fix it before disclosure.

## Checking releases

How to check that a download really comes from this repository's release workflow: [docs/VERIFY.md](docs/VERIFY.md).
