import { readFileSync } from 'node:fs';

/** Decode file bytes as text, tolerating what Windows PowerShell writes: a UTF-8
 *  BOM (Set-Content/Out-File -Encoding utf8) or UTF-16 with a BOM (`>`). A BOM
 *  makes JSON.parse throw, which used to silently drop agents' hive messages. */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const text = buf.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readTextFile(path: string): string {
  return decodeText(readFileSync(path));
}
