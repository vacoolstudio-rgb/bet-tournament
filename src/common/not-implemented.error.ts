/**
 * Marker for a skeleton method whose body lands in a later step.
 *
 * It exists so the shape of the code can be reviewed and tested before any
 * logic is written, and so "is this finished?" is a grep rather than a
 * judgement call:
 *
 *   grep -rn "NotImplementedError" src | wc -l   # must be 0 when done
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Throws {@link NotImplementedError} and names the collaborators the body will
 * use.
 *
 * The extra arguments are never read — they exist so that an injected
 * dependency counts as used while the method is still a stub, which keeps
 * `noUnusedLocals` on for the rest of the code base. Every call disappears
 * when the body is written.
 */
export function notImplemented(what: string, ..._willUse: readonly unknown[]): never {
  throw new NotImplementedError(what);
}
