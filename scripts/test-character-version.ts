import assert from "node:assert/strict";
import {
  belongsToCharacterVersion,
  characterSheetChanged,
  getCharacterVersion,
  normalizeCharacterSheet,
} from "@/lib/character-version";

assert.equal(getCharacterVersion({}), 1, "legacy documents are v1");
assert.equal(getCharacterVersion({ character_version: 3 }), 3);
assert.equal(getCharacterVersion({ character_version: 0 }), 1);
assert.equal(belongsToCharacterVersion({}, 1), true);
assert.equal(belongsToCharacterVersion({}, 2), false);
assert.equal(belongsToCharacterVersion({ character_version: 2 }, 2), true);
assert.equal(normalizeCharacterSheet("  A\r\nB  "), "A\nB");
assert.equal(characterSheetChanged("A\r\nB", " A\nB "), false);
assert.equal(characterSheetChanged("old", "new"), true);

console.log("Character-version tests passed.");
