import { registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { isMoneyAmount, MAX_MONEY_AMOUNT, MONEY_SCALE } from '../../common/money.js';

/**
 * Accepts a money amount as a decimal string or a JSON number.
 *
 * The bound and the scale are validated here rather than left to the column:
 * an amount that overflows NUMERIC(20,4) would otherwise arrive as a driver
 * error, be classified as an infrastructure failure, and be retried forever
 * instead of being parked once.
 */
export function IsMoneyAmount(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isMoneyAmount',
      target: object.constructor,
      propertyName,
      ...(options ? { options } : {}),
      validator: {
        validate: (value: unknown): boolean => isMoneyAmount(value),
        defaultMessage: (args?: ValidationArguments): string =>
          `${args?.property ?? 'value'} must be a non-negative decimal with at most ` +
          `${MONEY_SCALE} fraction digits and at most ${MAX_MONEY_AMOUNT}`,
      },
    });
  };
}
