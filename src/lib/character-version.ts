type CharacterVersioned = {
  character_version?: number | null;
};

/** Legacy account/post documents belong to the first character generation. */
export function getCharacterVersion(value: CharacterVersioned): number {
  const version = value.character_version;
  return typeof version === "number" && Number.isInteger(version) && version > 0
    ? version
    : 1;
}

export function belongsToCharacterVersion(
  value: CharacterVersioned,
  currentVersion: number,
): boolean {
  return getCharacterVersion(value) === currentVersion;
}

export function normalizeCharacterSheet(value?: string): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

export function characterSheetChanged(
  previous?: string,
  next?: string,
): boolean {
  return normalizeCharacterSheet(previous) !== normalizeCharacterSheet(next);
}
