# Speaker diarization (speaker-diarization): MOSS-Transcribe-Diarize Q8_0 run by transcribe.cpp on CPU, behind a
# small standard-library HTTP server (server.py). transcribe-cli links statically, so only the binary is copied.
FROM debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ARG TCPP_COMMIT=5700f127e38dd53c4735ea23ef743b4b538eacd4
RUN mkdir /src && curl -fsSL https://codeload.github.com/handy-computer/transcribe.cpp/tar.gz/$TCPP_COMMIT \
    | tar xz -C /src --strip-components=1
# Portable x86-64 build (AVX2/FMA/F16C): the measured speeds in bench/README.md come from this configuration.
RUN cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
    && cmake --build /src/build -j 16 --target transcribe-cli

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /models diarize && mkdir /models && chown diarize /models
COPY --from=build /src/build/bin/transcribe-cli /opt/transcribe/bin/transcribe-cli
COPY server.py /opt/transcribe/server.py
USER diarize
EXPOSE 5002
CMD ["python3", "/opt/transcribe/server.py"]
