export function uniqueSessionIdPrefixes(sessionIds: readonly string[]): string[] {
  return sessionIds.map((sessionId) => {
    const minLength = Math.min(8, sessionId.length);
    for (let length = minLength; length <= sessionId.length; length++) {
      const prefix = sessionId.slice(0, length);
      if (sessionIds.filter((id) => id.startsWith(prefix)).length === 1) return prefix;
    }
    return sessionId;
  });
}
