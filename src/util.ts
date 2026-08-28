/** Case-insensitive value comparison, shared by input matching and grading. */
export function same(a: string, b: string): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase();
}
