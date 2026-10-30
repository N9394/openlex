# Verify your download

Every OpenLex release is built on GitHub's servers by the [release workflow](../.github/workflows/release.yml), not on a developer's laptop, and anyone can check that a file they downloaded is exactly what that workflow built from the public source. This page shows how.

There are three independent checks. The install scripts run them for you (see [below](#what-the-install-scripts-check)); you can also run them by hand.

| Check | Proves | Needs |
|---|---|---|
| **sha256** | the file was not damaged or cut off on the way | nothing extra |
| **GitHub attestation** | the file was built by this repository's release workflow, from a specific commit and tag | [GitHub CLI](https://cli.github.com) (`gh`), logged in |
| **Sigstore signature** | the same, checked against the public Sigstore transparency log instead of GitHub | [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) |

The checksum alone is **not** tamper-proof: it is published in the same release as the file, so someone who could replace the file could replace the checksum too. The attestation and the signature are tied to the workflow's identity on GitHub and cannot be produced on another machine.

## What a release contains

For version `X.Y.Z` (replace it in the commands below, e.g. `0.3.0`):

| File | What it is |
|---|---|
| `openlex-X.Y.Z.tar.gz` | The CLI and engine (one file for macOS, Linux and Windows; needs Node.js 20+). |
| `openlex-X.Y.Z.tar.gz.sha256` | Its SHA-256 checksum. |
| `openlex-X.Y.Z.cdx.json` | SBOM: the npm packages inside the tarball, in [CycloneDX](https://cyclonedx.org) format. |
| `install.sh`, `install.ps1` | The install scripts for macOS/Linux and Windows. |
| `OpenLex-X.Y.Z-mac-arm64.dmg`, `OpenLex-X.Y.Z-mac-x64.dmg` | The desktop app for Apple Silicon and Intel Macs. |
| `OpenLex-X.Y.Z-mac-arm64.zip`, `OpenLex-X.Y.Z-mac-x64.zip` | The same Mac apps as zip: what in-app updates install. |
| `OpenLex-X.Y.Z-windows-x64-setup.exe` | The desktop app for Windows. |
| `OpenLex-X.Y.Z-linux-x64.AppImage` | The desktop app for Linux. |
| `<installer>.sha256` | The installer's SHA-256 checksum. |
| `<installer>.cdx.json` | SBOM: everything inside the installed app (npm packages, Electron, Qdrant, llama.cpp), CycloneDX, made with [syft](https://github.com/anchore/syft). |
| `latest-mac.yml`, `latest.yml`, `latest-linux.yml` | Update metadata (version, file names, SHA-512, sizes) for update feeds. |
| `SHA256SUMS` | Checksums of all of the above. |
| `<file>.bundle` | The Sigstore signature bundle for each file above. |

The latest install scripts always have the same addresses:

- https://github.com/N9394/openlex/releases/latest/download/install.sh
- https://github.com/N9394/openlex/releases/latest/download/install.ps1

(These work once a release built by the workflow has been published. `https://openlex.pinemarshlands.com/install` redirects there.)

Releases up to and including 0.2.2 were built by hand. They have a `.sha256` file but no signature, attestation or SBOM.

## 1. Checksum

```sh
# macOS / Linux, in the folder with both files
shasum -a 256 -c openlex-X.Y.Z.tar.gz.sha256        # or: sha256sum -c openlex-X.Y.Z.tar.gz.sha256
```

```powershell
# Windows PowerShell
(Get-FileHash openlex-X.Y.Z.tar.gz -Algorithm SHA256).Hash.ToLower()
Get-Content openlex-X.Y.Z.tar.gz.sha256              # the first word must be the same
```

## 2. GitHub attestation

```sh
gh auth login                                        # once
gh attestation verify openlex-X.Y.Z.tar.gz --repo N9394/openlex
```

It prints the workflow, the commit and the tag the file was built from. To insist on the release workflow specifically:

```sh
gh attestation verify openlex-X.Y.Z.tar.gz --repo N9394/openlex \
  --signer-workflow N9394/openlex/.github/workflows/release.yml
```

The same works for `install.sh`, `install.ps1`, `SHA256SUMS` and the SBOM. The SBOM is also attached to the tarball as its own attestation:

```sh
gh attestation verify openlex-X.Y.Z.tar.gz --repo N9394/openlex --predicate-type https://cyclonedx.org/bom
```

You can browse all attestations at https://github.com/N9394/openlex/attestations.

## 3. Sigstore signature (cosign)

```sh
cosign verify-blob openlex-X.Y.Z.tar.gz \
  --bundle openlex-X.Y.Z.tar.gz.bundle \
  --certificate-identity-regexp '^https://github\.com/N9394/openlex/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`Verified OK` means: the file was signed by the release workflow of `N9394/openlex`, running for a `v…` tag, and the signature is recorded in the public [Rekor](https://search.sigstore.dev) transparency log. For one exact version, use `--certificate-identity https://github.com/N9394/openlex/.github/workflows/release.yml@refs/tags/vX.Y.Z` instead of the regexp.

## Check an install script before running it

Instead of piping the script straight into a shell:

```sh
V=X.Y.Z
curl -fsSLO "https://github.com/N9394/openlex/releases/download/v$V/install.sh"
curl -fsSLO "https://github.com/N9394/openlex/releases/download/v$V/install.sh.bundle"
cosign verify-blob install.sh --bundle install.sh.bundle \
  --certificate-identity "https://github.com/N9394/openlex/.github/workflows/release.yml@refs/tags/v$V" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
# or: gh attestation verify install.sh --repo N9394/openlex
less install.sh && bash install.sh
```

Windows: download `install.ps1` the same way, check it with `gh attestation verify install.ps1 --repo N9394/openlex`, read it, then run `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

## What the install scripts check

`install.sh` and `install.ps1`:

1. always check the tarball's sha256 against the release's `.sha256` file and stop on a mismatch;
2. if `cosign` is installed, verify the tarball's Sigstore bundle against the release workflow identity for that exact tag, and stop if it does not match;
3. if `gh` is installed and logged in, run `gh attestation verify … --repo N9394/openlex`, and stop if it does not match;
4. print which checks were made. If neither tool is available they say so: *"Only the checksum was checked."* For releases without a signature (0.2.2 and earlier) they say that too.

They never skip a check silently, and a failed check always stops the install.

## Rebuild it yourself

The tarball is reproducible: the same tag gives the same bytes. On Linux (GNU tar) with Node.js 20:

```sh
git clone https://github.com/N9394/openlex && cd openlex
git checkout vX.Y.Z
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) bash scripts/package-cli.sh
cat dist/openlex-X.Y.Z.tar.gz.sha256                 # compare with the release's .sha256
```

`package-cli.sh` sorts the entries, sets owner 0:0, normalises file modes and sets every timestamp to the commit time; npm installs exactly what `sidecar/package-lock.json` lists. The release workflow builds the tarball twice and fails if the two differ. On macOS, install GNU tar first (`brew install gnu-tar`); a different npm major version than the release workflow's can change the result.

## What the SBOM covers

`openlex-X.Y.Z.cdx.json` lists the npm packages installed into the tarball (production dependencies, no optional native modules), generated with `npm sbom` from the lockfile. It does not list the few browser libraries vendored as files under `add-in/lib/`, the law data packs, or models (those are not in the tarball).

## Homebrew

The formula in [N9394/homebrew-openlex](https://github.com/N9394/homebrew-openlex) downloads the same release tarball and checks its sha256. To check its origin, run the attestation or cosign check above on the tarball in Homebrew's cache (`brew --cache openlex`).

## Desktop installers

The installers on the release page are built by the same workflow and checked the same way, for example:

```sh
shasum -a 256 -c OpenLex-X.Y.Z-mac-arm64.dmg.sha256
gh attestation verify OpenLex-X.Y.Z-mac-arm64.dmg --repo N9394/openlex
gh attestation verify OpenLex-X.Y.Z-mac-arm64.dmg --repo N9394/openlex --predicate-type https://cyclonedx.org/bom   # its SBOM
cosign verify-blob OpenLex-X.Y.Z-mac-arm64.dmg --bundle OpenLex-X.Y.Z-mac-arm64.dmg.bundle \
  --certificate-identity-regexp '^https://github\.com/N9394/openlex/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

```powershell
(Get-FileHash OpenLex-X.Y.Z-windows-x64-setup.exe -Algorithm SHA256).Hash.ToLower()
Get-Content OpenLex-X.Y.Z-windows-x64-setup.exe.sha256        # the first word must be the same
```

They are **not signed by Apple or Microsoft** (macOS: ad hoc signature, not notarised; Windows: no Authenticode signature), so macOS and Windows warn on first start; [the desktop app guide](guides/desktop-app.md) shows how to open them. The Sigstore signature and the attestation above are what tie them to this repository. They contain no model weights.

When the release workflow has signing certificates, it builds signed and notarised installers instead, under the same names. Signed installers (from the release page or through support) can also be checked by the operating system: `spctl -a -vv /Applications/OpenLex.app` on macOS, *Properties → Digital Signatures* or `Get-AuthenticodeSignature` on Windows.

## Found something that does not verify?

Do not install it, and tell us privately: see [SECURITY.md](../SECURITY.md).
