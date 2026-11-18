import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import type { MediaProvider, MediaRequest, MediaResult } from "./provider.ts";

const WIDTH = 108;
const HEIGHT = 192; // 9:16

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Einfarbiges 9:16-PNG ohne Abhängigkeiten. */
export function solidPng(r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // Bit-Tiefe
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + WIDTH * 3);
  for (let x = 0; x < WIDTH; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: HEIGHT }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Kostenloser Platzhalter ohne Netzwerk: Farbe wird aus dem Prompt abgeleitet. */
export function createDummyProvider(): MediaProvider {
  return {
    name: "dummy",
    type: "image",
    async generate(req: MediaRequest): Promise<MediaResult> {
      const h = createHash("sha256").update(req.prompt).digest();
      return {
        data: solidPng(h[0]!, h[1]!, h[2]!),
        type: "image",
        extension: "png",
        costUsd: 0,
      };
    },
  };
}
