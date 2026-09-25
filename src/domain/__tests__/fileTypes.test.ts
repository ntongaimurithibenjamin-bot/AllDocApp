import { classifyImport, defaultExtension, describeKind, fileExtension, titleFromFileName } from '../fileTypes';

describe('classifyImport', () => {
  it.each([
    ['Lease.pdf', null, 'pdf'],
    ['scan', 'application/pdf', 'pdf'],
    ['photo.HEIC', null, 'image'],
    ['IMG_1.jpg', 'image/jpeg', 'image'],
    ['notes.md', null, 'text'],
    ['config', 'application/json', 'text'],
    ['Report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'],
    ['Budget.xlsx', null, 'sheet'],
    ['Old budget.xls', null, 'sheet'],
    ['data.csv', 'text/csv', 'sheet'],
    ['Slides.pptx', null, 'slides'],
    ['Legacy.doc', 'application/msword', 'other'],
    ['Deck.ppt', null, 'other'],
    ['Book.epub', null, 'other'],
    ['movie.mp4', 'video/mp4', 'unsupported'],
    ['archive.zip', 'application/zip', 'unsupported'],
  ])('%s (%s) → %s', (name, mime, expected) => {
    expect(classifyImport(name, mime)).toBe(expected);
  });

  it('trusts the extension over a generic or wrong MIME type from the sending app', () => {
    expect(classifyImport('Report.docx', 'application/octet-stream')).toBe('word');
    expect(classifyImport('Budget.xlsx', 'application/zip')).toBe('sheet');
  });

  it('falls back to the MIME type when a shared file has no extension', () => {
    expect(classifyImport('document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('slides');
    expect(classifyImport('1234', 'text/plain; charset=utf-8')).toBe('text');
  });
});

describe('file names and kinds', () => {
  it('extracts extensions and titles', () => {
    expect(fileExtension('A.Report.PDF')).toBe('pdf');
    expect(fileExtension('README')).toBe('');
    expect(titleFromFileName('SMA3101 Assignment 1.pdf')).toBe('SMA3101 Assignment 1');
    expect(titleFromFileName('.pdf')).toBe('.pdf');
  });

  it('picks sensible defaults for extension-less files', () => {
    expect(defaultExtension('word', null)).toBe('docx');
    expect(defaultExtension('sheet', 'text/csv')).toBe('csv');
    expect(defaultExtension('slides', null)).toBe('pptx');
  });

  it('describes kinds for lists', () => {
    expect(describeKind('sheet')).toBe('Spreadsheet');
    expect(describeKind('other')).toBe('File');
  });
});
