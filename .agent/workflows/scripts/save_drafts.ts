/**
 * Disabled compatibility entry point.
 *
 * The former implementation wrote directly to Firestore and bypassed
 * character-version checks, external evidence verification, editorial gates
 * and reviewed-text hash binding. Direct writes to drafts are prohibited.
 */
console.error(
  "Direct Firestore draft writes are disabled. " +
  "Submit a complete Buzz Editorial Harness packet and save only through create_drafts.",
);
process.exitCode = 1;
