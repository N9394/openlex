#!/bin/bash
# Import the Lotus AI GGUF into local Ollama so the plugin runs the real
# product model (the spec-card 4B fine-tune).
#
# Usage:
#   1. Get the GGUF onto this machine (from the server, or wherever it lives):
#        scp root@$OPENLEX_DEPLOY_HOST:/opt/lexvault-packs/models/lotus-ai-q4km.gguf ~/.lexvault/models/
#   2. Run this script.
set -euo pipefail

MODEL_PATH="${1:-$HOME/.lexvault/models/lotus-ai-q4km.gguf}"
NAME="lotus-ai-4b-q4_k_m"   # must match the tier-registry variant name

if [ ! -f "$MODEL_PATH" ]; then
  echo "GGUF not found: $MODEL_PATH"
  echo "Download it first (2.7 GB):"
  echo "  mkdir -p ~/.lexvault/models"
  echo "  scp root@$OPENLEX_DEPLOY_HOST:/opt/lexvault-packs/models/lotus-ai-q4km.gguf ~/.lexvault/models/"
  exit 1
fi

TMP="$(mktemp -d)"
cat > "$TMP/Modelfile" << EOF
FROM $MODEL_PATH
TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}<|im_start|>user
{{ .Prompt }}<|im_end|>
<|im_start|>assistant
"""
SYSTEM "You are LexVault, a legal drafting assistant. Analyze documents against in-force law, suggest changes as comments, cite statutes by full name. Work only from provided sources."
PARAMETER temperature 0
PARAMETER top_p 0.1
PARAMETER num_ctx 8192
EOF

ollama create "$NAME" -f "$TMP/Modelfile"
rm -rf "$TMP"
echo "Imported as '$NAME'. Start the sidecar with LEXVAULT_LLM_MODEL=$NAME (default already matches)."
