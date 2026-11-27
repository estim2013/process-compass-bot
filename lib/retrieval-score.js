export function hybridRetrievalScore(lexicalRank, semanticRank, coverage) {
  return (lexicalRank ? 1 / (60 + lexicalRank) : 0)
    + (semanticRank ? 1 / (60 + semanticRank) : 0)
    + 0.03 * Math.max(0, Math.min(1, Number(coverage) || 0));
}
