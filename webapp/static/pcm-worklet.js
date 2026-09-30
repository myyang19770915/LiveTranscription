class PCM16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input?.length) this.port.postMessage(input.slice());
    return true;
  }
}
registerProcessor('pcm16-processor', PCM16Processor);
