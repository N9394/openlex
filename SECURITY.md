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

## Safe harbour

We will not take legal action against anyone who reports a vulnerability in good faith under this policy, avoids harming users and their data (use your own test data, never real client files), and gives us reasonable time to fix it before disclosure.

## Checking releases

How to check that a download really comes from this repository's release workflow: [docs/VERIFY.md](docs/VERIFY.md).
