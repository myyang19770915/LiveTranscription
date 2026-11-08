#!/bin/sh
# MOSS-Transcribe-Diarize Q8_0 through transcribe.cpp on CPU (the production setup) for every clip in CLIPS;
# writes hyp/<TAG>/<clip>.json like the other runners. Run in bench/diarize/work inside the diarize service image:
#   docker run --rm --entrypoint sh -v "<work>:/work" -w /work <diarize image> ../run_tcpp.sh moss-q8cpu data/clips 16
# (mount bench/diarize at /work/.. or copy run_tcpp.sh and tcpp_parse.py into work).
TAG=$1; CLIPS=${2:-data/clips}; THREADS=${3:-16}; MODEL=${MODEL:-/models/MOSS-Transcribe-Diarize-Q8_0.gguf}
mkdir -p "tcpp-out/$TAG" "hyp/$TAG"
for wav in "$CLIPS"/*.wav; do
  name=$(basename "$wav" .wav); start=$(date +%s)
  /opt/transcribe/bin/transcribe-cli -m "$MODEL" --diarize --threads "$THREADS" -q "$wav" > "tcpp-out/$TAG/$name.txt"
  echo "$name $(( $(date +%s) - start ))" | tee -a "tcpp-out/$TAG/times.txt"
done
python3 tcpp_parse.py "$TAG" "$CLIPS"
