# Choose your AI

OpenLex doesn't come with its own AI service, and it never sends your work through our servers. You choose the model, and you can use the AI your firm already pays for and trusts.

## Option 1: on your own computer

The most private choice: nothing leaves the machine. You need a capable computer, for example Apple Silicon with 16 GB of memory or more, or an NVIDIA graphics card with 8 GB or more.

- **Ollama:** if [Ollama](https://ollama.com) is running on your computer, OpenLex uses it. Pull a model first, for example `ollama pull qwen3:8b`.
- **llama.cpp:** put a `.gguf` model file in `~/.lexvault/models/`, have `llama-server` on your PATH, and set `OPENLEX_LLM_MODEL` to the file's name without `.gguf`. The desktop app ships with llama.cpp and downloads a model for you.

```bash
openlex use local
openlex test
```

## Option 2: your own API key

Use a key from a model provider. OpenLex talks to the provider directly from your computer.

| Provider | `openlex use …` | Notes |
|---|---|---|
| Anthropic (Claude) | `anthropic` | |
| OpenAI | `openai` | |
| Mistral | `mistral` | Hosted in the EU |
| OpenRouter | `openrouter:<model>` | Many models with one key, e.g. `openrouter:qwen/qwen3.5-9b` |

```bash
openlex use anthropic
openlex key anthropic      # typed hidden, or piped in: … | openlex key anthropic
openlex test
```

**Where the key is kept:** in your operating system's keychain (macOS Keychain, Windows Credential Manager, the Secret Service on Linux). Never in a file in your folders, and never on our servers. Remove it with `openlex key anthropic --remove`.

**Chat subscriptions are not API keys.** A ChatGPT Plus or Claude Pro subscription is for the chat website and can't be used by other programs. You need an API key from the provider's developer console, or your firm's enterprise account (option 3).

## Option 3: your firm's cloud account

New to this? [Get a secure cloud AI key](cloud-key.md) walks you through Claude on AWS Bedrock in the EU, step by step.

If your firm already has an enterprise agreement with a cloud provider, use that. The data then stays under your firm's contract, in the region you choose.

| Service | `openlex use …` | What you need |
|---|---|---|
| Azure OpenAI | `azure --base-url https://<resource>.openai.azure.com/openai/deployments/<deployment>` | the deployment's key |
| AWS Bedrock | `bedrock --region eu-central-1` | a Bedrock API key |
| Google Vertex AI | `vertex --region europe-west1` | a service-account key, or your `gcloud` login |

## Option 4: your firm's own gateway

Any server that speaks the OpenAI chat API works, for example vLLM, LM Studio or LiteLLM:

```bash
openlex use custom:<model> --base-url https://ai.yourfirm.internal/v1
```

A custom server counts as cloud until you say otherwise, so the default rules keep client data away from it.

## Different models for different steps

Firms can send drafting to one model, checking to another, and keep privileged matters on the local model. This is set in the firm's `openlex.json`; see [the harness map](../HARNESS.md). Each model is driven by a profile (how it thinks, how it calls tools, its context size), which you can adjust too. `openlex models` shows the current picture.

## See what is set up

```bash
openlex providers     # all options, which is active, which have a key
openlex status        # is the model ready?
```
