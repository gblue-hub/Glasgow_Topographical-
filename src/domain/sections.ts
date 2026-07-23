export function sectionCodeValue(code: string) {
  const normalised = code.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalised)) return Number.POSITIVE_INFINITY;
  return [...normalised].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

export function compareSectionCodes(
  left: { code: string },
  right: { code: string },
) {
  const difference = sectionCodeValue(left.code) - sectionCodeValue(right.code);
  return Number.isNaN(difference)
    ? left.code.localeCompare(right.code, "en-GB")
    : difference;
}
