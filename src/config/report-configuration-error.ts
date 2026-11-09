import { ConfigurationError } from '../common/errors.js';

/**
 * Prints a configuration problem the way a person can act on it.
 *
 * Every entry point needs this and each one used to decide for itself: the
 * service printed the message and exited, while the tools printed the stack
 * and then the `issues` array again underneath it — forty lines in which the
 * two missing variables were the least visible part. Whoever runs
 * `npm run produce` straight after a clone is exactly the reader who needs the
 * short version.
 *
 * Returns whether it recognised the error, so a caller can leave anything else
 * alone rather than swallow it.
 */
export function reportConfigurationError(error: unknown): boolean {
  if (!(error instanceof ConfigurationError)) return false;

  console.error(error.message);
  console.error('\nCopy .env.example to .env, or set the variables in the environment.');

  return true;
}
