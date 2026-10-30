# Desktop app

The desktop app brings research, document analysis and due diligence together in one window. It includes a local AI runtime (llama.cpp), so it can work fully offline. No account is needed.

## Install (recommended)

Paste one line. It downloads the app from [GitHub Releases](https://github.com/N9394/openlex/releases/latest), checks it against the release's checksum (and its signature, if `cosign` or `gh` is installed) and installs it. There are no warnings to click through, and no administrator rights are needed.

**macOS** (Terminal: press ⌘ Space, type *Terminal*, press Enter):

```bash
curl -fsSL https://openlex.pinemarshlands.com/install | bash -s -- --app
```

OpenLex goes into **Applications** (the right version for Apple Silicon or Intel). Open it from Launchpad or the Applications folder.

**Windows** (Windows Terminal or PowerShell):

```powershell
$env:OPENLEX_APP = 1; irm https://openlex.pinemarshlands.com/install.ps1 | iex
```

OpenLex is installed for your user account and appears in the Start menu.

**Linux:**

```bash
curl -fsSL https://openlex.pinemarshlands.com/install | bash -s -- --app
```

The AppImage goes to `~/Applications/OpenLex.AppImage`, with an entry in your applications menu. Some distributions need `libfuse2` for AppImages (Ubuntu: `sudo apt install libfuse2`, on 24.04 and newer `libfuse2t64`).

Use `--all` instead of `--app` (Windows: `$env:OPENLEX_ALL = 1`) to also install the [terminal app](terminal-app.md). Run the same line again to update.

## Or download it yourself

| Your computer | File on [GitHub Releases](https://github.com/N9394/openlex/releases/latest) |
|---|---|
| Mac with Apple Silicon (M1 or newer) | `OpenLex-X.Y.Z-mac-arm64.dmg` |
| Mac with an Intel processor | `OpenLex-X.Y.Z-mac-x64.dmg` |
| Windows 10 or 11 | `OpenLex-X.Y.Z-windows-x64-setup.exe` |
| Linux | `OpenLex-X.Y.Z-linux-x64.AppImage` |

These downloads are not signed by Apple or Microsoft, so when you download them in a browser your computer warns you the first time. That is expected. You only have to do this once.

**macOS**

1. Open the `.dmg` and drag **OpenLex** into **Applications**.
2. Open OpenLex. macOS says it cannot check the app ("Apple could not verify…"). Click **Done** (or **OK**).
3. Open **System Settings → Privacy & Security**, scroll down to the message about OpenLex and click **Open Anyway**. Confirm with your password.

On older macOS versions (14 Sonoma and earlier) you can instead right-click OpenLex in Applications, choose **Open**, then **Open** again.

**Windows**

1. Run the `.exe`. If Windows shows "Windows protected your PC" (SmartScreen), click **More info**, then **Run anyway**.
2. The installer puts OpenLex in your Start menu. It needs no administrator rights.

**Linux**

Make the AppImage executable and run it: `chmod +x OpenLex-*.AppImage && ./OpenLex-*.AppImage`. Some distributions need `libfuse2` for AppImages.

No model is included in the download. Use your own cloud key, your firm's cloud account, a llama-server or Ollama endpoint, or a `.gguf` model file (see [Choose your AI](choose-your-ai.md)).

## Check your download

Each installer has a `.sha256` checksum, a signature (`.bundle`) and a GitHub attestation that show it was built from this repository by its release workflow. How to check them: [Verify your download](../VERIFY.md).

Firms that need installers signed by Apple (notarised) or Microsoft (Authenticode) can get signed builds through support.

## Updating

Run the install line again, or download the new version and install it over the old one. Your settings, matters and models stay where they are.

Builds from a distributor with a licence update themselves: the app downloads the new version, checks it, and asks you to restart. On a Mac it replaces `OpenLex.app` in place; if it cannot (for example when the app is not in a folder you can write to, or was opened straight from the disk image), it tells you and shows the downloaded file to install by hand.

If you used the older app called **LexVault**, OpenLex picks up its settings and data. On a Mac, you can delete `LexVault.app` from Applications afterwards; on Windows, the OpenLex installer replaces it.

## Hardware for local models

With a local model, your computer sets the speed. With your own cloud key or your firm's cloud account, any computer works.

| | Examples |
|---|---|
| Recommended | Apple Silicon M2 or newer with 16 GB+ · NVIDIA RTX 3060 12 GB or better · 16 GB+ memory |
| Workable, slower | 16 GB laptop without a graphics card · 8 GB graphics cards |
| Use a cloud key instead | less than 16 GB memory · 8 GB Apple Silicon |

## Settings

The app shares its settings with the Word add-in and the terminal app: the AI model, client data rules, matters and the firm library.
