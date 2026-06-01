import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { createTrayIconPng } from "../src/main/trayIcon";

describe("tray icon", () => {
  it("generates a non-empty PNG icon for the Windows tray", () => {
    const icon = createTrayIconPng(32);
    expect(icon.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(icon.includes(Buffer.from("IHDR"))).toBe(true);
    expect(icon.includes(Buffer.from("IDAT"))).toBe(true);

    const idatIndex = icon.indexOf(Buffer.from("IDAT"));
    const idatLength = icon.readUInt32BE(idatIndex - 4);
    const idat = icon.subarray(idatIndex + 4, idatIndex + 4 + idatLength);
    const raw = inflateSync(idat);
    let visiblePixels = 0;
    for (let y = 0; y < 32; y += 1) {
      const rowStart = y * (32 * 4 + 1);
      for (let x = 0; x < 32; x += 1) {
        if (raw[rowStart + 1 + x * 4 + 3] > 0) {
          visiblePixels += 1;
        }
      }
    }
    expect(visiblePixels).toBeGreaterThan(700);
  });
});
