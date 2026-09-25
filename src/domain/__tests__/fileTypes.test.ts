import { classifyImport, fileExtension, titleFromFileName } from '../fileTypes';

describe('classifyImport', () => {
  it.each([
    ['Lease.pdf', null, 'pdf'],
    ['scan', 'application/pdf', 'pdf'],
    ['photo.HEIC', null, 'image'],
    ['IMG_1.jpg', 'image/jpeg', 'image'],
    ['notes.md', null, 'text'],
    ['data.csv', 'text/csv', 'text'],
    ['config', 'application/json', 'text'],
    ['Report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'office'],
    ['Budget.xlsx', null, 'office'],
    ['Slides.pptx', null, 'office'],
    ['movie.mp4', 'video/mp4', 'unsupported'],
    ['archive.zip', 'application/zip', 'unsupported'],
  ])('%s (%s) → %s', (name, mime, expected) => {
    expect(classifyImport(name, mime)).toBe(expected);
  });
});

describe('file names', () => {
  it('extracts extensions and titles', () => {
    expect(fileExtension('A.Report.PDF')).toBe('pdf');
    expect(fileExtension('README')).toBe('');
    expect(titleFromFileName('SMA3101 Assignment 1.pdf')).toBe('SMA3101 Assignment 1');
    expect(titleFromFileName('.pdf')).toBe('.pdf');
  });
});
