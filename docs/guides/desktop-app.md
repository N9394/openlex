# Desktop app

The desktop app brings research, document analysis and due diligence together in one window. It includes a local AI runtime (llama.cpp), so it can work fully offline. No account is needed.

## Download

Get the newest version from [GitHub Releases](https://github.com/N9394/openlex/releases/latest):

| Your computer | File |
|---|---|
| Mac with Apple Silicon (M1 or newer) | `OpenLex-X.Y.Z-mac-arm64.dmg` |
| Mac with an Intel processor | `OpenLex-X.Y.Z-mac-x64.dmg` |
| Windows 10 or 11 | `OpenLex-X.Y.Z-windows-x64-setup.exe` |
| Linux | `OpenLex-X.Y.Z-linux-x64.AppImage` |

No model is included in the download. Use your own cloud key, your firm's cloud account, a llama-server or Ollama endpoint, or a `.gguf` model file (see [Choose your AI](choose-your-ai.md)).

## Install and open it the first time

These downloads are not signed by Apple or Microsoft, so your computer warns you the first time. That is expected. You only have to do this once.

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

## Check your download

Each installer has a `.sha256` checksum, a signature (`.bundle`) and a GitHub attestation that show it was built from this repository by its release workflow. How to check them: [Verify your download](../VERIFY.md).

Firms that need installers signed by Apple (notarised) or Microsoft (Authenticode) can get signed builds through support.

## Updating

Download the new version and install it over the old one. Your settings, matters and models stay where they are.

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
