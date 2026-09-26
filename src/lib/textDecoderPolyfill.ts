/**
 * pdf-lib decodes some PDF strings with TextDecoder('utf-8' | 'latin1'). Hermes may not provide
 * TextDecoder, or only UTF-8. This installs a small spec-compatible fallback for exactly those two
 * encodings, and leaves a complete native implementation untouched.
 */

type DecodeInput = ArrayBuffer | ArrayBufferView | undefined;

function toBytes(input: DecodeInput): Uint8Array {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

export function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
  }
  return out;
}

/**
 * UTF-8 decoder following the WHATWG Encoding Standard: each maximal invalid subsequence becomes one
 * U+FFFD (or throws when `fatal`), matching what browsers and Node produce.
 */
export function decodeUtf8(bytes: Uint8Array, fatal = false): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  const emit = (codePoint: number) => {
    chunk.push(codePoint);
    if (chunk.length >= 4096) {
      parts.push(String.fromCodePoint(...chunk));
      chunk = [];
    }
  };
  const error = () => {
    if (fatal) throw new TypeError('The encoded data was not valid utf-8');
    emit(0xfffd);
  };

  let codePoint = 0;
  let needed = 0;
  let seen = 0;
  let lower = 0x80;
  let upper = 0xbf;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (needed === 0) {
      if (byte <= 0x7f) emit(byte);
      else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        codePoint = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
        needed = 2;
        codePoint = byte & 0x0f;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
        needed = 3;
        codePoint = byte & 0x07;
      } else error();
      continue;
    }
    if (byte < lower || byte > upper) {
      // Invalid continuation: one U+FFFD for the sequence so far, then re-read this byte.
      codePoint = needed = seen = 0;
      lower = 0x80;
      upper = 0xbf;
      error();
      i--;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    codePoint = (codePoint << 6) | (byte & 0x3f);
    if (++seen === needed) {
      emit(codePoint);
      codePoint = needed = seen = 0;
    }
  }
  if (needed !== 0) error();
  parts.push(String.fromCodePoint(...chunk));
  return parts.join('');
}

class FallbackTextDecoder {
  readonly encoding: 'utf-8' | 'windows-1252';
  readonly fatal: boolean;
  readonly ignoreBOM = false;

  constructor(label = 'utf-8', options: { fatal?: boolean } = {}) {
    const normalized = label.trim().toLowerCase();
    if (normalized === 'utf-8' || normalized === 'utf8' || normalized === 'unicode-1-1-utf-8') this.encoding = 'utf-8';
    else if (['latin1', 'iso-8859-1', 'windows-1252', 'ascii', 'us-ascii'].includes(normalized)) this.encoding = 'windows-1252';
    else throw new RangeError(`Unsupported encoding: ${label}`);
    this.fatal = Boolean(options.fatal);
  }

  decode(input?: DecodeInput): string {
    const bytes = toBytes(input);
    return this.encoding === 'utf-8' ? decodeUtf8(bytes, this.fatal) : decodeLatin1(bytes);
  }
}

function nativeSupportsLatin1(): boolean {
  try {
    return typeof TextDecoder !== 'undefined' && new TextDecoder('latin1').decode(new Uint8Array([0xe9])) === 'é';
  } catch {
    return false;
  }
}

export function installTextDecoderPolyfill(): void {
  if (nativeSupportsLatin1()) return;
  (globalThis as { TextDecoder?: unknown }).TextDecoder = FallbackTextDecoder;
}
