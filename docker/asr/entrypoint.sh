#!/usr/bin/env bash
set -euo pipefail

# Install the ASR package with the versions pinned in constraints.txt (app-image-reproducible). A restart reuses the
# install; a changed pyproject.toml or constraints.txt (new dependency, new pin) installs again.
INSTALL_STAMP=/var/lib/confucius4-r2t2.install
wanted="$(cat /workspace/pyproject.toml /workspace/docker/asr/constraints.txt | sha256sum | cut -d' ' -f1)"
if ! python -m pip show confucius4-r2t2 2>/dev/null | grep -q "^Editable project location: /workspace$"     || [[ "$(cat "${INSTALL_STAMP}" 2>/dev/null)" != "${wanted}" ]]; then
  python -m pip install --no-cache-dir -c /workspace/docker/asr/constraints.txt -e /workspace "huggingface_hub[cli]"
  echo "${wanted}" > "${INSTALL_STAMP}"
fi

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
