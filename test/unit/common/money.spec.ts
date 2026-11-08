import { Decimal } from 'decimal.js';
import { AmountOutOfRangeError } from '../../../src/common/errors.js';
import {
  floorPoints,
  isFxRate,
  isMoneyAmount,
  MAX_MONEY_AMOUNT,
  MAX_POINTS,
  parseMoney,
  parseRate,
  POINTS_SCALE,
  toColumn,
  toPoints,
} from '../../../src/common/money.js';

describe('isMoneyAmount', () => {
  it.each([
    ['zero', '0'],
    ['integer', '42'],
    ['one fraction digit', '0.5'],
    ['full money scale', '12.3400'],
    ['the upper bound itself', MAX_MONEY_AMOUNT],
    ['a JSON number', 10.4],
    ['a JSON integer', 10],
    ['surrounding whitespace', ' 12.50 '],
  ])('accepts %s', (_case, value) => {
    expect(isMoneyAmount(value)).toBe(true);
  });

  it.each([
    ['a negative amount', '-1'],
    ['a negative JSON number', -0.01],
    ['more digits than the column holds', '1.00001'],
    // Exponent notation is far more likely to be a producer bug than a
    // deliberate 1000, and accepting it would make the column scale a lie.
    ['exponent notation', '1e3'],
    ['a value above the bound', '1000000000001'],
    ['a non-numeric string', 'abc'],
    ['an empty string', ''],
    ['a lone separator', '.'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['undefined', undefined],
    ['an object', { amount: 1 }],
    ['a boolean', true],
  ])('rejects %s', (_case, value) => {
    expect(isMoneyAmount(value)).toBe(false);
  });
});

describe('isFxRate', () => {
  it.each([
    ['a fiat rate', '1.08'],
    ['a sub-unit rate', '0.000024'],
    ['a crypto-sized rate', '98000'],
    ['a JSON number', 1.27],
  ])('accepts %s', (_case, value) => {
    expect(isFxRate(value)).toBe(true);
  });

  it.each([
    // A zero rate would silently score every bet in that currency as nothing,
    // and a negative one would subtract points for winning.
    ['zero', '0'],
    ['a negative rate', '-1.08'],
    ['a non-numeric string', 'abc'],
    ['an empty string', ''],
    ['a rate above the bound', '10000000'],
    ['null', null],
  ])('rejects %s', (_case, value) => {
    expect(isFxRate(value)).toBe(false);
  });
});

describe('parseMoney', () => {
  it('returns the exact decimal, not a float', () => {
    expect(parseMoney('winAmount', '0.1').plus(parseMoney('winAmount', '0.2')).toString()).toBe(
      '0.3',
    );
  });

  it('accepts a JSON number', () => {
    expect(parseMoney('stake', 10.4).toString()).toBe('10.4');
  });

  it.each([
    ['-1', 'a negative amount'],
    ['1.00001', 'too many fraction digits'],
    ['1000000000001', 'a value above the bound'],
    ['abc', 'a non-numeric string'],
  ])('rejects %s (%s)', (value) => {
    expect(() => parseMoney('winAmount', value)).toThrow(AmountOutOfRangeError);
  });

  it('names the offending field, so the parked message says which one', () => {
    expect(() => parseMoney('winAmount', '-1')).toThrow(/winAmount/);
  });
});

describe('parseRate', () => {
  it('returns the exact decimal', () => {
    expect(parseRate('EUR', '1.08').toString()).toBe('1.08');
  });

  it('rejects a rate the config validation would not have allowed', () => {
    expect(() => parseRate('EUR', '0')).toThrow(AmountOutOfRangeError);
  });
});

describe('toPoints', () => {
  it('converts the won amount to USD', () => {
    expect(toPoints(new Decimal('10.40'), new Decimal('1.08')).toString()).toBe('11.232');
  });

  it('leaves a USD win untouched', () => {
    expect(toPoints(new Decimal('25.5000'), new Decimal('1')).toString()).toBe('25.5');
  });

  it('scores a losing bet as zero', () => {
    expect(toPoints(new Decimal('0'), new Decimal('1.08')).isZero()).toBe(true);
  });

  it('keeps fractions instead of rounding to whole points', () => {
    // Ten wins of 0.6 USD must come to 6 points, not 0 — which is what
    // flooring on every event would produce.
    const once = toPoints(new Decimal('0.60'), new Decimal('1'));

    expect(once.mul(10).toString()).toBe('6');
  });

  it('truncates below the points scale rather than rounding up', () => {
    // A rate carries up to 8 digits and an amount up to 4, so their product
    // can run past the 6 digits the column holds. Truncating keeps the stored
    // value and the credited value identical: rounding up would credit a
    // micro-point that was never earned, and the rollback would then subtract
    // a different number than the settle added.
    expect(toPoints(new Decimal('3.0000'), new Decimal('0.33333333')).toString()).toBe('0.999999');
    expect(toPoints(new Decimal('1.0000'), new Decimal('0.00000019')).toString()).toBe('0');
  });

  it('keeps every digit of a large amount times an eight-digit rate', () => {
    // decimal.js defaults to 20 significant digits and this product needs 24:
    // 13 integer digits, 4 from the amount's scale, 8 from the rate's. The
    // exact value is 1000000009999.999899999999, so truncating to the points
    // scale gives …999899 — whereas at the default precision the tail is
    // rounded away first and the answer comes out …999900 instead.
    //
    // Six micro-points is nothing; being unable to say which number was
    // credited is not, because the rollback has to subtract exactly that one.
    const points = toPoints(new Decimal('999999999999.9999'), new Decimal('1.00000001'));

    expect(points.toString()).toBe('1000000009999.999899');
  });

  it('rejects a product the points column cannot hold', () => {
    // Both factors are individually acceptable; their product is not. Caught
    // here it is a parked message, uncaught it is a driver error that looks
    // like an outage and gets retried forever.
    expect(() => toPoints(new Decimal(MAX_MONEY_AMOUNT), new Decimal('1000'))).toThrow(
      AmountOutOfRangeError,
    );
  });

  it('accepts a product exactly at the limit', () => {
    expect(toPoints(new Decimal(MAX_POINTS), new Decimal('1')).toString()).toBe(MAX_POINTS);
  });
});

describe('floorPoints', () => {
  it.each([
    ['11.232000', 11],
    ['11.999999', 11],
    ['0.000000', 0],
    ['0.999999', 0],
    ['1532.480000', 1532],
  ])('floors %s to %i', (points, expected) => {
    expect(floorPoints(points)).toBe(expected);
  });

  it('accepts a Decimal as well as a column string', () => {
    expect(floorPoints(new Decimal('11.9'))).toBe(11);
  });
});

describe('toColumn', () => {
  it('pads to the column scale so stored text is comparable', () => {
    expect(toColumn(new Decimal('11.232'), POINTS_SCALE)).toBe('11.232000');
  });

  it('formats zero at full scale', () => {
    expect(toColumn(new Decimal(0), POINTS_SCALE)).toBe('0.000000');
  });
});
