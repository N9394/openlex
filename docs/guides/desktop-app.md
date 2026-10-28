# Desktop app

The desktop app brings research, document analysis and due diligence together in one window. It includes a local AI runtime (llama.cpp), so it can work fully offline.

## Install

Download it from the [download page](https://openlex.pinemarshlands.com/download): Apple Silicon or Intel Mac (`.zip`), Windows (`.exe`) or Linux (`.AppImage`).

- **macOS:** unzip, move OpenLex to Applications, then right-click it and choose **Open** the first time. The app isn't notarised yet.
- **Windows:** run the installer. If SmartScreen warns you, choose **More info → Run anyway**.
- **Linux:** `chmod +x` the AppImage and run it.

> The current installers still use the old name LexVault and ask you to sign in on first start. The next release removes both, and no account will be needed.

## Hardware for local models

With a local model, your computer sets the speed. With your own cloud key or your firm's cloud account, any computer works.

| | Examples |
|---|---|
| Recommended | Apple Silicon M2 or newer with 16 GB+ · NVIDIA RTX 3060 12 GB or better · 16 GB+ memory |
| Workable, slower | 16 GB laptop without a graphics card · 8 GB graphics cards |
| Use a cloud key instead | less than 16 GB memory · 8 GB Apple Silicon |

## Settings

The app shares its settings with the Word add-in and the terminal app: the AI model, client data rules, matters and the firm library.
