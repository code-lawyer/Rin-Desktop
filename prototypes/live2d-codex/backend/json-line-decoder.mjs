// Handles arbitrary stream chunk boundaries and split UTF-8 characters.
export class JsonLineDecoder {
  #buffer = Buffer.alloc(0);
  constructor(onMessage, { maxLineBytes = 8 * 1024 * 1024 } = {}) { this.onMessage = onMessage; this.maxLineBytes = maxLineBytes; }
  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    let end;
    while ((end = this.#buffer.indexOf(10)) !== -1) {
      if (end > this.maxLineBytes) throw new Error('RPC line exceeds limit');
      const line = this.#buffer.subarray(0,end).toString('utf8').trim(); this.#buffer = this.#buffer.subarray(end+1);
      if (line) this.onMessage(JSON.parse(line));
    }
    if (this.#buffer.length > this.maxLineBytes) throw new Error('RPC line exceeds limit');
  }
}
