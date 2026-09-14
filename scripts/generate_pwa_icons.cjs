const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Helper to create valid PNG file
function createPng(width, height, isMaskable = false) {
  const raw = Buffer.alloc(height * (1 + width * 4));

  // Colors:
  // Terracotta: #b0592c -> r: 176, g: 89, b: 44
  // White: #ffffff -> r: 255, g: 255, b: 255
  const bgR = 176, bgG = 89, bgB = 44;

  const center = width / 2;
  const scale = width / 64; // base 64 grid
  const scissorScale = isMaskable ? scale * 0.75 : scale * 0.9;
  const cornerRadius = isMaskable ? 0 : width * 0.22;

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // Filter none

    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;

      // Check rounded corners for non-maskable
      if (!isMaskable) {
        const dx = Math.min(x, width - 1 - x);
        const dy = Math.min(y, height - 1 - y);
        if (dx < cornerRadius && dy < cornerRadius) {
          const dist = Math.hypot(cornerRadius - dx, cornerRadius - dy);
          if (dist > cornerRadius) {
            // Transparent outside rounded corner
            raw[px] = 0; raw[px + 1] = 0; raw[px + 2] = 0; raw[px + 3] = 0;
            continue;
          }
        }
      }

      // Default terracotta background
      let r = bgR, g = bgG, b = bgB, a = 255;

      // Normalized coordinates relative to center
      const nx = (x - center) / scissorScale;
      const ny = (y - center) / scissorScale;

      // Scissor handles (two circles at bottom: centers at (-9, 14) and (9, 14))
      const leftHandleDist = Math.hypot(nx - (-9), ny - 14);
      const rightHandleDist = Math.hypot(nx - 9, ny - 14);
      const ringOuter = 8.5;
      const ringInner = 4.2;

      const isLeftRing = leftHandleDist <= ringOuter && leftHandleDist >= ringInner;
      const isRightRing = rightHandleDist <= ringOuter && rightHandleDist >= ringInner;

      // Blades crossing from (-6, 7) to (12, -18) and (6, 7) to (-12, -18)
      // Blade 1
      const x1 = -6, y1 = 7, x2 = 12, y2 = -18;
      const dBlade1 = Math.abs((y2 - y1) * nx - (x2 - x1) * ny + x2 * y1 - y2 * x1) / Math.hypot(y2 - y1, x2 - x1);
      const inRange1 = ny <= 7 && ny >= -18;

      // Blade 2
      const x3 = 6, y3 = 7, x4 = -12, y4 = -18;
      const dBlade2 = Math.abs((y4 - y3) * nx - (x4 - x3) * ny + x4 * y3 - y4 * x3) / Math.hypot(y4 - y3, x4 - x3);
      const inRange2 = ny <= 7 && ny >= -18;

      const isBlade1 = dBlade1 < 2.5 && inRange1;
      const isBlade2 = dBlade2 < 2.5 && inRange2;

      // Center pivot at (0, 2)
      const isPivot = Math.hypot(nx, ny - 2) <= 3.2;

      if (isLeftRing || isRightRing || isBlade1 || isBlade2 || isPivot) {
        r = 255; g = 255; b = 255;
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }

  // PNG compression and chunk construction
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    crcTable[i] = c;
  }
  function crc32(buf) {
    let c = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
    return (c ^ (-1)) >>> 0;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const chunk = Buffer.alloc(12 + len);
    chunk.writeUInt32BE(len, 0);
    chunk.write(type, 4);
    data.copy(chunk, 8);
    const crcBuf = Buffer.concat([Buffer.from(type), data]);
    chunk.writeUInt32BE(crc32(crcBuf), 8 + len);
    return chunk;
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", zlib.deflateSync(raw, { level: 9 }));
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.join(__dirname, "..", "public");

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-192-maskable.png", size: 192, maskable: true },
  { file: "icon-512-maskable.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
];

targets.forEach(({ file, size, maskable }) => {
  const filePath = path.join(publicDir, file);
  const buf = createPng(size, size, maskable);
  fs.writeFileSync(filePath, buf);
  console.log(`Generated ${file} (${size}x${size}, maskable: ${maskable}) — ${buf.length} bytes`);
});
