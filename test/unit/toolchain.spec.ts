import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * Guards the Vitest + SWC setup rather than any business rule.
 *
 * Nest injects by type, which only works if the transform emits
 * `design:paramtypes`. Vitest's default esbuild transform does not, so if
 * `unplugin-swc` or the `decoratorMetadata` flag ever falls out of
 * `vitest.config.ts`, every DI-based suite starts failing with "Nest can't
 * resolve dependencies" — a confusing symptom with a trivial cause. This test
 * fails first and points straight at it.
 */
@Injectable()
class FxRate {
  readonly value = 2;
}

@Injectable()
class Scorer {
  constructor(private readonly rate: FxRate) {}

  score(amount: number): number {
    return amount * this.rate.value;
  }
}

describe('toolchain', () => {
  it('emits decorator metadata so Nest can resolve constructor types', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [FxRate, Scorer] }).compile();

    expect(moduleRef.get(Scorer).score(21)).toBe(42);
  });
});
