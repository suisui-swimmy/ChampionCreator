const SAME_ROW_TOLERANCE_PX = 1;

export const getActiveGuideSectionIndex = (
  sectionTops: readonly number[],
  activationLine: number,
  currentIndex = -1,
  atPageEnd = false,
): number => {
  if (sectionTops.length === 0) {
    return -1;
  }

  if (atPageEnd) {
    return sectionTops.length - 1;
  }

  const passedIndices = sectionTops
    .map((top, index) => ({ index, top }))
    .filter(({ top }) => top <= activationLine);

  if (passedIndices.length === 0) {
    return 0;
  }

  const activeRowTop = Math.max(...passedIndices.map(({ top }) => top));
  const activeRowIndices = passedIndices
    .filter(({ top }) => Math.abs(top - activeRowTop) <= SAME_ROW_TOLERANCE_PX)
    .map(({ index }) => index);

  return activeRowIndices.includes(currentIndex) ? currentIndex : activeRowIndices[0];
};
