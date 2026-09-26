import { decodeLatin1, decodeUtf8 } from '../textDecoderPolyfill';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('decodeUtf8', () => {
  it.each(['plain ascii', 'KSh 25,000 — ✓', 'ℝ = Q ∪ Qᶜ', 'emoji 📄 ok', ''])('round-trips %s', (text) => {
    expect(decodeUtf8(utf8(text))).toBe(text);
  });

  it('replaces invalid bytes, or throws when fatal', () => {
    const invalid = new Uint8Array([0x61, 0xff, 0x62, 0xc3]);
    expect(decodeUtf8(invalid)).toBe('a�b�');
    expect(() => decodeUtf8(invalid, true)).toThrow(TypeError);
    // A truncated 3-byte sequence is a single error, not one per byte.
    expect(decodeUtf8(new Uint8Array([0xe2, 0x82, 0x41]))).toBe('�A');
  });

  it('matches the platform decoder on random byte soup', () => {
    const native = new TextDecoder('utf-8');
    for (let n = 0; n < 2000; n++) {
      const bytes = new Uint8Array(24).map(() => Math.floor(Math.random() * 256));
      expect(decodeUtf8(bytes)).toBe(native.decode(bytes));
    }
  });
});

describe('decodeLatin1', () => {
  it('maps each byte to one character', () => {
    expect(decodeLatin1(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
    expect(decodeLatin1(new Uint8Array(20000).fill(0x41))).toHaveLength(20000);
  });
});
