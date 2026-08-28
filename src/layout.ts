/**
 * Split questions into the vertical columns a printed sheet uses: column 1
 * holds 1..n, column 2 continues from there. Trailing columns come back
 * shorter (or empty) when the count does not divide evenly.
 *
 * ```ts
 * columnize(5, 2); // [[1, 2, 3], [4, 5]]
 * ```
 */
export function columnize(questions: number, columns = 1): number[][] {
  const total = Math.max(0, Math.floor(questions));
  const count = Math.max(1, Math.floor(columns));
  const perColumn = Math.ceil(total / count) || 0;
  return Array.from({ length: count }, (_, c) =>
    Array.from({ length: perColumn }, (_, r) => c * perColumn + r + 1).filter(
      (n) => n <= total,
    ),
  );
}
