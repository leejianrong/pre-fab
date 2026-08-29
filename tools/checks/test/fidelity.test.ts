import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { pixelDiffPercent } from "../src/fidelity.js";

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

describe("pixelDiffPercent (R9 fidelity harness)", () => {
  it("is 0% for a byte-identical pair", () => {
    const a = solidPng(10, 10, [10, 20, 30, 255]);
    const b = solidPng(10, 10, [10, 20, 30, 255]);
    expect(pixelDiffPercent(a, b)).toBe(0);
  });

  it("is 100% when every pixel differs", () => {
    const a = solidPng(10, 10, [0, 0, 0, 255]);
    const b = solidPng(10, 10, [255, 255, 255, 255]);
    expect(pixelDiffPercent(a, b)).toBe(100);
  });

  it("treats a dimension mismatch as a full failure rather than throwing", () => {
    const a = solidPng(10, 10, [0, 0, 0, 255]);
    const b = solidPng(20, 10, [0, 0, 0, 255]);
    expect(pixelDiffPercent(a, b)).toBe(100);
  });

  it("is proportional for a partial mismatch", () => {
    const png = new PNG({ width: 10, height: 10 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
      png.data[i + 3] = 255;
    }
    const a = PNG.sync.write(png);
    // Flip exactly one pixel (row 0, col 0) to white — 1 of 100 pixels, 1%.
    png.data[0] = 255;
    png.data[1] = 255;
    png.data[2] = 255;
    const b = PNG.sync.write(png);
    expect(pixelDiffPercent(a, b)).toBeCloseTo(1, 5);
  });
});
