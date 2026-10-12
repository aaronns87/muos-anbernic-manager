// A minimal WebSocket server connection (RFC 6455) for the SSH terminal: text and binary messages,
// fragmentation, ping/pong and close. Enough for one browser tab talking to this server.

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type http from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 1 << 20;

export class WebSocket extends EventEmitter {
  closed = false;
  #socket: Duplex;
  #buf: Buffer = Buffer.alloc(0);
  #parts: Buffer[] = [];
  #partOp = 0;

  constructor(socket: Duplex, head: Buffer) {
    super();
    this.#socket = socket;
    (socket as Duplex & { setNoDelay?: (on: boolean) => void }).setNoDelay?.(true);
    socket.on("data", (d: Buffer) => this.#onData(d));
    socket.on("drain", () => this.emit("drain"));
    socket.on("error", () => socket.destroy());
    socket.on("close", () => this.#finish());
    if (head.length) this.#onData(head);
  }

  /** Sends bytes; false means the socket is backed up and "drain" follows. */
  sendBinary(data: Buffer | Uint8Array): boolean {
    return this.#frame(2, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }

  sendJson(message: unknown): boolean {
    return this.#frame(1, Buffer.from(JSON.stringify(message), "utf8"));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.#frame(8, body);
    this.#socket.end();
    this.#finish();
  }

  #finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }

  #frame(op: number, data: Buffer): boolean {
    if (this.closed || this.#socket.destroyed) return true;
    const n = data.length;
    const head = Buffer.alloc(n < 126 ? 2 : n < 65536 ? 4 : 10);
    head[0] = 0x80 | op;
    if (n < 126) head[1] = n;
    else if (n < 65536) { head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    return this.#socket.write(Buffer.concat([head, data]));
  }

  #onData(chunk: Buffer): void {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    while (!this.closed && this.#parseOne());
  }

  #parseOne(): boolean {
    const b = this.#buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f;
    if ((b[1] & 0x80) === 0) { this.close(1002, "unmasked frame"); return false; }
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return false;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_MESSAGE)) { this.close(1009); return false; }
      len = Number(big); off = 10;
    }
    if (len > MAX_MESSAGE) { this.close(1009); return false; }
    if (b.length < off + 4 + len) return false;
    const mask = b.subarray(off, off + 4);
    const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    this.#buf = b.subarray(off + 4 + len);

    if (op === 8) { this.close(); return false; }
    if (op === 9) { this.#frame(10, data); return true; }
    if (op === 10) return true;
    if (op > 2) { this.close(1003); return false; }
    if (op !== 0) { this.#partOp = op; this.#parts = []; }
    this.#parts.push(data);
    if (this.#parts.reduce((n, p) => n + p.length, 0) > MAX_MESSAGE) { this.close(1009); return false; }
    if (fin) {
      const message = this.#parts.length === 1 ? this.#parts[0] : Buffer.concat(this.#parts);
      this.#parts = [];
      if (this.#partOp === 1) this.emit("text", message.toString("utf8"));
      else this.emit("binary", message);
    }
    return true;
  }
}

/** Completes the handshake for an "upgrade" request, or answers 400 and returns null. */
export function acceptWebSocket(req: http.IncomingMessage, socket: Duplex, head: Buffer): WebSocket | null {
  const key = String(req.headers["sec-websocket-key"] ?? "");
  if (String(req.headers.upgrade ?? "").toLowerCase() !== "websocket" || !key) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return null;
  }
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new WebSocket(socket, head);
}
