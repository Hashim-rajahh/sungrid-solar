// Reads just enough of a PNG file to check size and transparency, with no dependencies.
import { readFile } from 'node:fs/promises';

const SIGNATURE = '89504e470d0a1a0a';

/** @returns {Promise<{width:number, height:number, colorType:number, hasTransparency:boolean, bytes:number}>} */
export async function pngInfo(file) {
  const buf = await readFile(file);
  if (buf.length < 33 || buf.subarray(0, 8).toString('hex') !== SIGNATURE) {
    throw new Error(`${file} is not a PNG file`);
  }
  const chunks = [];
  for (let off = 8; off + 12 <= buf.length; ) {
    const length = buf.readUInt32BE(off);
    chunks.push(buf.toString('ascii', off + 4, off + 8));
    off += 12 + length;
  }
  const colorType = buf[25];
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType,
    // 4 and 6 carry an alpha channel; palette images (3) mark transparency in a tRNS chunk.
    hasTransparency: colorType === 4 || colorType === 6 || chunks.includes('tRNS'),
    bytes: buf.length,
  };
}
