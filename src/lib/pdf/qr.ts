/**
 * Pure TypeScript ISO/IEC 18004 QR Code matrix generator (Versions 1–10, Byte mode, ECC Level M).
 * Zero external dependencies so PDFKit draws infinitely sharp vector rectangles.
 */

interface VersionSpec {
  version: number;
  dataBytes: number;
  ecPerBlock: number;
  blocks: Array<[count: number, dataLen: number]>;
  align: number[];
  remainderBits: number;
}

const VERSIONS_M: VersionSpec[] = [
  { version: 1, dataBytes: 16, ecPerBlock: 10, blocks: [[1, 16]], align: [], remainderBits: 0 },
  { version: 2, dataBytes: 28, ecPerBlock: 16, blocks: [[1, 28]], align: [6, 18], remainderBits: 7 },
  { version: 3, dataBytes: 44, ecPerBlock: 26, blocks: [[1, 44]], align: [6, 22], remainderBits: 7 },
  { version: 4, dataBytes: 64, ecPerBlock: 18, blocks: [[2, 32]], align: [6, 26], remainderBits: 7 },
  { version: 5, dataBytes: 86, ecPerBlock: 24, blocks: [[2, 43]], align: [6, 30], remainderBits: 7 },
  { version: 6, dataBytes: 108, ecPerBlock: 16, blocks: [[4, 27]], align: [6, 34], remainderBits: 7 },
  { version: 7, dataBytes: 124, ecPerBlock: 18, blocks: [[4, 31]], align: [6, 22, 38], remainderBits: 0 },
  { version: 8, dataBytes: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42], remainderBits: 0 },
  { version: 9, dataBytes: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]], align: [6, 26, 46], remainderBits: 0 },
  { version: 10, dataBytes: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]], align: [6, 28, 50], remainderBits: 0 },
];

// GF(256) exp/log tables with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const factor = [1, GF_EXP[i]];
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      for (let k = 0; k < 2; k++) {
        next[j + k] ^= gfMul(poly[j], factor[k]);
      }
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array<number>(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

function appendBits(bits: number[], val: number, len: number) {
  for (let i = len - 1; i >= 0; i--) {
    bits.push((val >>> i) & 1);
  }
}

function bchVersionInfo(version: number): number {
  let d = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((d >>> i) & 1) {
      d ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | d;
}

function bchFormatInfoM(mask: number): number {
  // ECC level M = 00 in 2-bit format code
  const data = (0b00 << 3) | (mask & 7);
  let d = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((d >>> i) & 1) {
      d ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | d) ^ 0x5412;
}

function evaluatePenalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;

  // Rule 1: 5+ consecutive same color in row or col
  for (let r = 0; r < n; r++) {
    let runLen = 1;
    for (let c = 1; c < n; c++) {
      if (m[r][c] === m[r][c - 1]) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runLen = 1;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    let runLen = 1;
    for (let r = 1; r < n; r++) {
      if (m[r][c] === m[r - 1][c]) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runLen = 1;
      }
    }
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 4: Proportion of dark modules
  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) dark++;
    }
  }
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

function maskCond(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

export function encodeQrMatrix(input: string): boolean[][] {
  const bytes = Array.from(Buffer.from(input.trim() || "https://thegardenchurch.com", "utf8"));
  const clipped = bytes.length > 213 ? bytes.slice(0, 213) : bytes;

  const spec =
    VERSIONS_M.find((v) => {
      const ccBits = v.version >= 10 ? 16 : 8;
      const totalDataBits = 4 + ccBits + clipped.length * 8;
      return totalDataBits <= v.dataBytes * 8;
    }) || VERSIONS_M[VERSIONS_M.length - 1];

  const ccBits = spec.version >= 10 ? 16 : 8;
  const maxBytes = spec.dataBytes;
  const maxDataPayload = maxBytes - (ccBits === 16 ? 3 : 2);
  const payload = clipped.slice(0, maxDataPayload);

  // Encode data bits (Byte mode 0100)
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, payload.length, ccBits);
  for (const b of payload) appendBits(bits, b, 8);

  const capBits = spec.dataBytes * 8;
  const terminator = Math.min(4, capBits - bits.length);
  appendBits(bits, 0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < capBits) {
    appendBits(bits, padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    dataCodewords.push(val);
  }

  // Split into RS blocks & compute EC
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [count, dLen] of spec.blocks) {
    for (let b = 0; b < count; b++) {
      const slice = dataCodewords.slice(offset, offset + dLen);
      offset += dLen;
      dataBlocks.push(slice);
      ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
    }
  }

  // Interleave data codewords, then EC codewords
  const finalBytes: number[] = [];
  const maxD = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxD; i++) {
    for (const b of dataBlocks) {
      if (i < b.length) finalBytes.push(b[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const b of ecBlocks) {
      if (i < b.length) finalBytes.push(b[i]);
    }
  }

  const streamBits: number[] = [];
  for (const b of finalBytes) appendBits(streamBits, b, 8);
  for (let i = 0; i < spec.remainderBits; i++) streamBits.push(0);

  const size = 17 + spec.version * 4;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  const drawFinder = (topR: number, topC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = topC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        const dark = inOuter && dist !== 2;
        setFunc(r, c, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment patterns
  for (const ar of spec.align) {
    for (const ac of spec.align) {
      if (
        (ar <= 8 && ac <= 8) ||
        (ar <= 8 && ac >= size - 9) ||
        (ar >= size - 9 && ac <= 8)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunc(ar + dr, ac + dc, dist !== 1);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunc[6][i]) setFunc(6, i, i % 2 === 0);
    if (!isFunc[i][6]) setFunc(i, 6, i % 2 === 0);
  }

  // Dark module
  setFunc(size - 8, 8, true);

  // Reserve format info cells
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFunc[8][i] = true;
      isFunc[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunc[8][size - 1 - i] = true;
  }
  for (let i = 0; i < 7; i++) {
    isFunc[size - 1 - i][8] = true;
  }

  // Version info cells for >= 7
  if (spec.version >= 7) {
    const vBits = bchVersionInfo(spec.version);
    for (let i = 0; i < 18; i++) {
      const bit = Boolean((vBits >>> i) & 1);
      const a = Math.floor(i / 3);
      const b = i % 3;
      setFunc(size - 11 + b, a, bit);
      setFunc(a, size - 11 + b, bit);
    }
  }

  // Place data bits in upward/downward zigzag
  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let offsetC = 0; offsetC < 2; offsetC++) {
        const c = rightCol - offsetC;
        if (!isFunc[r][c]) {
          modules[r][c] = bitIdx < streamBits.length ? Boolean(streamBits[bitIdx++]) : false;
        }
      }
    }
    upward = !upward;
  }

  // Evaluate all 8 masks and keep lowest penalty
  let bestMask = 0;
  let bestScore = Infinity;
  let bestMatrix: boolean[][] = modules;

  for (let mask = 0; mask < 8; mask++) {
    const cand = modules.map((row, r) =>
      row.map((val, c) => (!isFunc[r][c] && maskCond(mask, r, c) ? !val : val))
    );
    const fmt = bchFormatInfoM(mask);
    // Copy 1: LSB (i=0) at (0,8) down to (8,8), then left to MSB (i=14) at (8,0)
    for (let i = 0; i <= 5; i++) {
      cand[i][8] = Boolean((fmt >>> i) & 1);
    }
    cand[7][8] = Boolean((fmt >>> 6) & 1);
    cand[8][8] = Boolean((fmt >>> 7) & 1);
    cand[8][7] = Boolean((fmt >>> 8) & 1);
    for (let i = 9; i < 15; i++) {
      cand[8][14 - i] = Boolean((fmt >>> i) & 1);
    }
    // Copy 2: LSB (i=0..7) horizontally across top-right (8, size-1-i), MSB (i=8..14) vertically bottom-left
    for (let i = 0; i < 8; i++) {
      cand[8][size - 1 - i] = Boolean((fmt >>> i) & 1);
    }
    for (let i = 8; i < 15; i++) {
      cand[size - 15 + i][8] = Boolean((fmt >>> i) & 1);
    }

    const score = evaluatePenalty(cand);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestMatrix = cand;
    }
  }

  void bestMask;
  return bestMatrix;
}
