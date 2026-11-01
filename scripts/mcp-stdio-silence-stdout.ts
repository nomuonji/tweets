/**
 * Keeps stdout clean for the stdio MCP transport.
 *
 * stdout carries JSON-RPC frames, so a stray console.log from a service would corrupt
 * the stream. This module is imported before the MCP server graph, which puts the
 * redirection in place before any tool code runs. console.error already goes to stderr
 * and is left alone.
 */

function render(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const toStderr = (...args: unknown[]) => {
  process.stderr.write(`${args.map(render).join(" ")}\n`);
};

console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
