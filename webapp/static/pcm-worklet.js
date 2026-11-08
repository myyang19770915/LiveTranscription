// Mono float samples to the main thread in 20 ms batches (asr-latency): one message per render quantum (128 samples,
// 2.7 ms at 48 kHz) meant ~375 WebSocket messages a second through the gateway to the engine; 20 ms is one MAI frame.
class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.target = Math.round(sampleRate / 50);
    this.buffer = new Float32Array(this.target);
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(this.target - this.filled, input.length - offset);
      this.buffer.set(input.subarray(offset, offset + take), this.filled);
      this.filled += take; offset += take;
      if (this.filled === this.target) { this.port.postMessage(this.buffer.slice()); this.filled = 0; }
    }
    return true;
  }
}
registerProcessor('pcm16-processor', PCM16Processor);
