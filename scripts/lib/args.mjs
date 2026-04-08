/**
 * args.mjs — Minimal argument parser.
 *
 * Supports --flag, --key value, --key=value, and positional args.
 * No external dependencies.
 */

/**
 * @typedef {Object} ParsedArgs
 * @property {string|undefined} command - First positional arg (subcommand).
 * @property {Record<string, string|boolean>} flags - Named flags and key-value pairs.
 * @property {string[]} positionals - Remaining positional args after the command.
 */

/**
 * Parse a CLI argument vector.
 * @param {string[]} [argv=process.argv.slice(2)]
 * @returns {ParsedArgs}
 */
export function parseArgs(argv = process.argv.slice(2)) {
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      // Everything after -- is positional
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        // --key=value
        const key = arg.slice(2, eqIndex);
        flags[key] = arg.slice(eqIndex + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          // --key value
          flags[key] = next;
          i++;
        } else {
          // --flag (boolean)
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }

  const command = positionals.shift();
  return { command, flags, positionals };
}
