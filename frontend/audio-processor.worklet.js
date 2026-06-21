/**
 * audio-processor.worklet.js
 * Vakya AI — AudioWorkletProcessor (replaces deprecated ScriptProcessorNode)
 *
 * HOST IT alongside index.html (same origin required for AudioWorklet).
 * Register once in script.js with:
 *   await audioContext.audioWorklet.addModule('./audio-processor.worklet.js');
 */

class VakyaRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffers = [];
  }

  process(inputs) {
    // inputs[0][0] = first input, first channel (mono)
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      // Copy — the underlying ArrayBuffer is reused each quantum
      this.port.postMessage({ type: 'audio', samples: channel.slice() });
    }
    // Returning true keeps the processor alive
    return true;
  }
}

registerProcessor('vakya-recorder-processor', VakyaRecorderProcessor);
