import * as CFB from 'cfb';

/**
 * Reads the VBA source of an Excel macro-enabled workbook (xl/vbaProject.bin, MS-OVBA). Master Office does not run
 * VBA — macros are JavaScript (docs/ARCHITECTURE.md §24) — but the source is kept and shown read-only so people can
 * see what the workbook did and rewrite it.
 */

export interface VbaModule {
  name: string;
  kind: 'module' | 'document' | 'class';
  code: string;
}

/** MS-OVBA 2.4.1 decompression of a CompressedContainer. */
export function decompress(buf: Uint8Array, start = 0): Uint8Array {
  if (buf[start] !== 0x01) throw new Error('not a VBA compressed container');
  const out: number[] = [];
  let pos = start + 1;
  while (pos < buf.length) {
    const header = buf[pos] | (buf[pos + 1] << 8);
    const size = (header & 0x0fff) + 3;
    const compressed = (header & 0x8000) !== 0;
    const chunkEnd = Math.min(buf.length, pos + size);
    pos += 2;
    const chunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096 && pos < chunkEnd; i++) out.push(buf[pos++]);
      continue;
    }
    while (pos < chunkEnd) {
      const flags = buf[pos++];
      for (let bit = 0; bit < 8 && pos < chunkEnd; bit++) {
        if ((flags & (1 << bit)) === 0) {
          out.push(buf[pos++]);
          continue;
        }
        const token = buf[pos] | (buf[pos + 1] << 8);
        pos += 2;
        const difference = out.length - chunkStart;
        const bitCount = Math.max(Math.ceil(Math.log2(difference)), 4);
        const lengthMask = 0xffff >> bitCount;
        const offsetMask = ~lengthMask & 0xffff;
        const length = (token & lengthMask) + 3;
        const offset = ((token & offsetMask) >> (16 - bitCount)) + 1;
        const from = out.length - offset;
        for (let i = 0; i < length; i++) out.push(out[from + i]);
      }
    }
  }
  return Uint8Array.from(out);
}

const decoder = (codepage: number) => {
  const label = codepage === 65001 ? 'utf-8' : codepage === 932 ? 'shift_jis' : codepage === 1258 ? 'windows-1258' : `windows-${codepage}`;
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('windows-1252');
  }
};

/** Modules of a vbaProject.bin (from the dir stream: names, stream names, source offsets, codepage). */
export function readVbaProject(bin: Uint8Array): VbaModule[] {
  const cfb = CFB.read(Buffer.from(bin), { type: 'buffer' });
  // cfb.find matches full paths ("Root Entry/VBA/dir"); try the usual spellings.
  const stream = (path: string) => {
    for (const p of [path, `/${path}`, `Root Entry/${path}`]) {
      const e = CFB.find(cfb, p);
      if (e?.content) return Uint8Array.from(e.content as ArrayLike<number>);
    }
    return null;
  };
  const dirRaw = stream('VBA/dir');
  if (!dirRaw) return [];
  const dir = decompress(dirRaw);
  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let codepage = 1252;
  const modules: { name?: string; stream?: string; offset?: number; kind: VbaModule['kind'] }[] = [];
  let cur: (typeof modules)[number] | null = null;
  let p = 0;
  while (p + 6 <= dir.length) {
    const id = view.getUint16(p, true);
    const size = view.getUint32(p + 2, true);
    p += 6;
    // PROJECTVERSION's size field says 4 but the record carries 6 more bytes (MS-OVBA 2.3.4.2.1.11).
    const len = id === 0x0009 ? 6 : size;
    const data = dir.subarray(p, p + len);
    const text = () => decoder(codepage).decode(data);
    switch (id) {
      case 0x0003:
        codepage = view.getUint16(p, true);
        break;
      case 0x0019: // MODULENAME
        cur = { kind: 'module', name: text() };
        modules.push(cur);
        break;
      case 0x001a: // MODULESTREAMNAME
        if (cur) cur.stream = text();
        break;
      case 0x0031: // MODULEOFFSET
        if (cur) cur.offset = view.getUint32(p, true);
        break;
      case 0x0022: // MODULETYPE: document or class module
        if (cur) cur.kind = /^(ThisWorkbook|Sheet\d+|Chart\d+)$/i.test(cur.name ?? '') ? 'document' : 'class';
        break;
    }
    p += len;
  }
  return modules
    .filter((m) => m.name)
    .map((m) => {
      const raw = stream(`VBA/${m.stream ?? m.name}`);
      let code = '';
      try {
        code = raw ? decoder(codepage).decode(decompress(raw, m.offset ?? 0)) : '';
      } catch {
        code = "' (source could not be decompressed)";
      }
      // Attribute lines are VBA metadata, not code the author wrote.
      code = code
        .split(/\r?\n/)
        .filter((l) => !/^Attribute VB_/.test(l))
        .join('\n')
        .trim();
      return { name: m.name!, kind: m.kind, code };
    })
    .filter((m) => m.code || m.kind === 'module');
}
