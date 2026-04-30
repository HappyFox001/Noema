/**
 * Merge finalized STT transcript segments for a single user turn.
 *
 * Some streaming STT providers emit final transcripts as incremental
 * segments, while others emit a cumulative hypothesis. Keep the whole user
 * turn without duplicating overlapping or repeated text.
 */
export function mergeFinalTranscriptText(current: string, next: string): string {
  const existing = current.trim()
  const incoming = next.trim()

  if (!incoming) {
    return existing
  }

  if (!existing) {
    return incoming
  }

  if (existing.includes(incoming)) {
    return existing
  }

  if (incoming.includes(existing)) {
    return incoming
  }

  const overlap = findSuffixPrefixOverlap(existing, incoming)
  if (overlap > 0) {
    return existing + incoming.slice(overlap)
  }

  return existing + incoming
}

function findSuffixPrefixOverlap(left: string, right: string): number {
  const max = Math.min(left.length, right.length)

  for (let length = max; length > 0; length--) {
    if (left.slice(-length) === right.slice(0, length)) {
      return length
    }
  }

  return 0
}
