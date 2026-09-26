import { shareFileName } from '../shareFile';


describe('shareFileName', () => {
  it('uses the document title with the original extension', () => {
    expect(shareFileName({ title: 'SMA 3103 NOTES 25_9', originalName: 'source-upload.PDF', kind: 'pdf' })).toBe('SMA 3103 NOTES 25_9.pdf');
    expect(shareFileName({ title: 'Lease', originalName: 'notes.md', kind: 'text' })).toBe('Lease.md');
  });

  it('falls back sensibly and strips characters Android file names cannot contain', () => {
    expect(shareFileName({ title: 'Q1: Report / Draft?', originalName: null, kind: 'pdf' })).toBe('Q1 Report Draft.pdf');
    expect(shareFileName({ title: '  ', originalName: null, kind: 'text' })).toBe('Document.txt');
  });
});
