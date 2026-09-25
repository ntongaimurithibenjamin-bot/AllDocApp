import { buildPagesHtml, buildTextHtml } from '../html';

describe('reader HTML', () => {
  it('lazy-loads pages with stable aspect ratios and starts at the requested page', () => {
    const html = buildPagesHtml(
      [
        { uri: 'file:///docs/a/p1.jpg', width: 1000, height: 1400 },
        { uri: 'file:///docs/a/p2.jpg', width: 1400, height: 1000 },
        { uri: 'file:///docs/a/p3.jpg', width: 1000, height: 1400 },
      ],
      { night: true, startPage: 2 },
    );
    expect(html).toContain('aspect-ratio:1400/1000');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('window.docuna.goToPage(2)');
    expect(html).toContain('<html class="night">');
  });

  it('embeds text safely: markup and script breakouts stay inert', () => {
    const text = '<script>alert(1)</script>\n</script><b>x</b>\u2028end';
    const html = buildTextHtml(text, { night: false, truncated: true, monospace: true });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('</script><b>x</b>');
    expect(html).not.toContain('\u2028');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('only the first 2 MB');

    // The embedded JSON round-trips to the exact original text.
    const json = /<script id="source" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(json)).toBe(text);
  });

  it('escapes attribute values in page URIs', () => {
    const html = buildPagesHtml([{ uri: 'file:///x"onerror="alert(1).jpg', width: 1, height: 1 }], { night: false, startPage: 1 });
    expect(html).not.toContain('"onerror="');
  });
});
