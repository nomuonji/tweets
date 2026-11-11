/**
 * Legacy server-side generation is intentionally disabled.
 *
 * This route can generate and write drafts without the evidence packet,
 * blind editorial review, Baka Model and Idea Resonance hard gates.
 * Keep the file so old workflow invocations fail closed with a clear reason.
 */
async function main() {
  console.error(
    "[Auto-Generate] BLOCKED: legacy generation bypasses the Buzz Editorial Harness. " +
    "Use get_generation_work -> get_generation_brief -> submit_buzz_harness_run -> create_drafts.",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[Auto-Generate] Unexpected shutdown:", error);
  process.exitCode = 1;
});
