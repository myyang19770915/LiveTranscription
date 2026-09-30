#!/usr/bin/env bash
set -euo pipefail

python -m pip install --no-cache-dir -e /workspace "huggingface_hub[cli]"

if [[ ! -f "${VAD_MODEL_PATH}/config.yaml" ]]; then
  mkdir -p "$(dirname "${VAD_MODEL_PATH}")"
  hf download FireRedTeam/FireRedVAD \
    --include "Stream-VAD/*" \
    --local-dir "$(dirname "${VAD_MODEL_PATH}")"
fi

exec python /workspace/ws_server.py \
  --ip 0.0.0.0 \
  --port 8272 \
  --asr_model_path "${ASR_MODEL_PATH}" \
  --vad_model_path "${VAD_MODEL_PATH}"
