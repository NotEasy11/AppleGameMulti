export function createScoreTracker() {
  let score = 0;
  let totalDrags = 0;
  let successfulDrags = 0;
  let maxRemovalCount = 0;

  return {
    recordDrag(removedCount) {
      totalDrags += 1;
      if (removedCount > 0) {
        successfulDrags += 1;
        score += removedCount;
        if (removedCount > maxRemovalCount) maxRemovalCount = removedCount;
      }
    },
    get score() {
      return score;
    },
    getSummary() {
      const accuracy = totalDrags === 0 ? 0 : successfulDrags / totalDrags;
      return { score, totalDrags, successfulDrags, maxRemovalCount, accuracy };
    },
  };
}
