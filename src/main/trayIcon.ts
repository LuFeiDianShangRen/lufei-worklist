import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function setPixel(pixels: Buffer, size: number, x: number, y: number, color: [number, number, number, number]): void {
  if (x < 0 || x >= size || y < 0 || y >= size) {
    return;
  }

  const offset = (y * size + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function isInsideRoundedRect(x: number, y: number, size: number, radius: number): boolean {
  const max = size - 1;
  const cx = x < radius ? radius : x > max - radius ? max - radius : x;
  const cy = y < radius ? radius : y > max - radius ? max - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function createIconPixels(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const yellow: [number, number, number, number] = [255, 210, 77, 255];
  const black: [number, number, number, number] = [17, 17, 17, 255];
  const radius = Math.max(4, Math.round(size * 0.2));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isInsideRoundedRect(x, y, size, radius)) {
        setPixel(pixels, size, x, y, yellow);
      }
    }
  }

  const scale = size / 32;
  const center = Math.round(size / 2);
  const drawRect = (left: number, top: number, width: number, height: number) => {
    for (let y = Math.round(top * scale); y < Math.round((top + height) * scale); y += 1) {
      for (let x = Math.round(left * scale); x < Math.round((left + width) * scale); x += 1) {
        setPixel(pixels, size, x, y, black);
      }
    }
  };

  drawRect(15, 7, 2, 4);
  for (let y = Math.round(10 * scale); y <= Math.round(22 * scale); y += 1) {
    const logicalY = y / scale;
    const halfWidth = Math.round((logicalY < 17 ? 3 + (logicalY - 10) * 0.75 : 8) * scale);
    for (let x = center - halfWidth; x <= center + halfWidth; x += 1) {
      setPixel(pixels, size, x, y, black);
    }
  }
  drawRect(8, 22, 16, 2);
  drawRect(14, 25, 4, 2);

  return pixels;
}

export function createTrayIconPng(size = 32): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const pixels = createIconPixels(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
