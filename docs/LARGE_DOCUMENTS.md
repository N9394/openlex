# Large documents

How OpenLex reads a long document depends on the model that reads it. The rules live in `sidecar/src/strategy.js`; the chat (`agent.js`), the full analysis (`analysis.js`) and batches (`batch.js`) use them.

## The AI on this computer (local model)

The local model has a small working memory (its "context"), so OpenLex keeps the method that works on a laptop:

- The document is split into sections of about 2,000 characters (`doc.js`, `compress.js`) and the model gets the **document map** (headings, defined terms).
- It **pulls sections on demand** (`get_range_text`), and for an edit request the target clause and its neighbours are **read in advance** (pre-read) so they are in context for planning and writing.
- A document that fits the working memory is read in full.
- The full analysis reads long documents in parts of 2,500–12,000 characters.

**Memory for the local AI** (Settings, `GET/POST /api/config/local-memory`, `local_memory.js`) sets how much memory (RAM, or the graphics card's VRAM) the local model may use. The model itself needs its file size (about 2.75 GB for the default 4B model) plus 0.3 GB; every further GB holds about 32,000 tokens of context (4-bit KV cache, 32 KB per token). The chosen context goes to llama.cpp as `--ctx-size` (the engine's own server and the desktop app's supervisor, which restarts the model when the setting changes) and to Ollama as `num_ctx`. Automatic (the default) keeps the earlier rule: the analysis-depth preset, capped by the RAM tier. The most it allows is 60% of RAM, or the graphics memory minus 0.5 GB.

What the lawyer reads: *More memory: more pages at once, but the AI takes longer to start and other programs have less memory. Less memory: it starts faster and reads long documents part by part (it still finds what it needs, it just looks things up more often).*

## AI services online (cloud models)

Cloud models handle large documents well, so OpenLex sends the **whole document** when it fits the model's context window with headroom. "Fits" uses the DeepSeek harness's compaction trigger (below): the prompt may use at most

    min(80% of the window, window − output reserve − min(64K, 25% of the window)) tokens

For Claude with a 200K window that is 146,000 tokens (about 550,000 characters, roughly 180 pages).

The document is placed in the **stable prefix** of the prompt (system prompt, before anything that changes per turn) and marked for **prompt caching** (`providers/common.js` `CACHE_MARK`):

- Claude (Anthropic API, Vertex): a `cache_control` breakpoint after the document. Documents of 200,000 characters or more get the 1-hour cache, because a lawyer's next question often comes later than five minutes. Cache reads cost about a tenth of the input price.
- Amazon Bedrock: a `cachePoint` after the document.
- OpenAI, DeepSeek, Mistral and others cache stable prefixes on their own; they get the same order without the mark.
- The local model gets the text without the mark.

**Beyond the window** OpenLex falls back to the structured approach: the full analysis reads the document in big parts (half the usable window each), and every part comes with the whole document's outline; the chat uses the document map and sections on demand, as with the local model.

## Many documents (batches)

A folder or a data room is analysed **one document at a time in the background** (`/api/batch/*`), with progress per file, Stop and Resume (also after OpenLex was closed). Before a big cloud run the lawyer sees an estimate and confirms it: *"About 480 pages in 37 documents, roughly 640,000 tokens to Claude (EU), est. $3.10."* Prices are list prices per million tokens (the firm can add its own in `openlex.json` → `prices`); for unknown services only the token count is shown.

## Files

One size rule: about **100 MB per file** (`limits.js`; `OPENLEX_MAX_FILE_MB` or `maxFileMB` in the agent settings). Above it the lawyer gets one sentence: split the file (for example one PDF per volume) or raise the limit.

## What we took from the DeepSeek harness

"DeepSeek harness" here means [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), DeepSeek's open-source agent harness. Its design notes describe:

- **No eager injection of uploads.** Files are stored as they are; the model reads them with a `read` tool in windows (2,000 lines or 50 KB per call, continuation hints such as "Use offset=… to continue"). Reason given: relevance is unknown at attach time, and lazy reads keep every access logged. *OpenLex keeps this for the local model and for documents beyond a cloud window (map + sections on demand). For a document that fits a cloud window we send it whole, as the founder decided: legal questions often need the whole text, and caching makes follow-ups cheap.*
- **Context budget with headroom.** Compaction starts at `min(80% of the window, window − output reserve − 65,536)`. *Adopted as OpenLex's "fits in full" rule (the 64K headroom shrinks to a quarter of small windows).*
- **Prefix-cache awareness.** The system prompt at the start is never rewritten; history is append-only; even the compaction call replays the previous request byte for byte so it extends the warm cache. *Adopted: the document sits in the stable prefix, everything that changes per turn (memory, the conversation) comes after the cache mark.*
- **DeepSeek's API** caches prefixes on disk automatically (best effort; usage reports `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`; [api-docs.deepseek.com/guides/kv_cache](https://api-docs.deepseek.com/guides/kv_cache)). The OpenAI-compatible provider benefits from the same prefix order.

The harness has no PDF or Word reading and no document-batch pipeline; those are OpenLex's own.
