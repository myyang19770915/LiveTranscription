// The audio worklet batches 20 ms (asr-latency): at 48 kHz, 10 render quanta of 128 samples give exactly one 960-sample
// message in order, and two more quanta give none. Usage: node bench/workletcheck.js
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import vm from 'node:vm';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'webapp', 'static', 'pcm-worklet.js'), 'utf8');
const posted = [];
class AudioWorkletProcessor { constructor() { this.port = {postMessage: m => posted.push(m)}; } }
const registry = {};
const context = {sampleRate: 48000, AudioWorkletProcessor, registerProcessor: (name, cls) => { registry[name] = cls; }, Float32Array};
vm.runInNewContext(source, context);
const processor = new registry['pcm16-processor']();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
const quantum = i => { const q = new Float32Array(128); for (let k = 0; k < 128; k++) q[k] = i * 128 + k; return [[q]]; };
for (let i = 0; i < 10; i++) processor.process(quantum(i));
check('ten quanta give exactly one message', posted.length === 1, posted.length);
check('the message is 960 samples', posted[0]?.length === 960, posted[0]?.length);
check('samples keep their order', posted[0] && posted[0].every((v, k) => v === k));
for (let i = 10; i < 12; i++) processor.process(quantum(i));
check('two more quanta give no message yet', posted.length === 1, posted.length);
check('silence (no input) sends nothing', processor.process([[]]) === true && posted.length === 1);
process.exit(failed ? 1 : 0);
