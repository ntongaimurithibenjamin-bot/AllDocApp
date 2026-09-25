/**
 * Android delivers "Open with Docuna" as a content:// (or file://) URL. Those aren't app routes:
 * the file itself is picked up natively and imported by <IncomingFilesHandler />, so the router
 * just stays on the home screen instead of showing "not found".
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (/^(content|file):\/\//i.test(path)) return '/';
  return path;
}
