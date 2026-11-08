import { registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { isIsoTimestamp } from '../../common/time.js';

/**
 * Requires an ISO-8601 instant with an explicit zone.
 *
 * `@IsISO8601()` accepts `2026-11-08T10:00:00`, which `new Date()` reads in the
 * server's local time — the same payload would then fall inside the tournament
 * window on one host and outside it on another.
 */
export function IsIsoTimestamp(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isIsoTimestamp',
      target: object.constructor,
      propertyName,
      ...(options ? { options } : {}),
      validator: {
        validate: (value: unknown): boolean => isIsoTimestamp(value),
        defaultMessage: (args?: ValidationArguments): string =>
          `${args?.property ?? 'value'} must be an ISO-8601 timestamp with an explicit ` +
          `timezone (for example 2026-11-08T10:00:00.000Z)`,
      },
    });
  };
}
