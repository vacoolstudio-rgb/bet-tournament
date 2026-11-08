import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

/**
 * Validates the `X-Player-Id` header.
 *
 * Absent — or present and blank, which is the same thing from a client's point
 * of view — is allowed and yields undefined: the leaderboard is public and the
 * caller simply gets no `me` block. Present but malformed is a client error,
 * because silently ignoring it would answer "you have no points" to a player
 * who has some.
 *
 * This is identification, not authentication: the header is trusted because
 * the task specifies it. In production the id comes from a verified token, and
 * that note belongs in the README rather than in a comment nobody reads.
 */
@Injectable()
export class PlayerIdPipe implements PipeTransform<string | undefined, string | undefined> {
  transform(value: string | undefined): string | undefined {
    const header = value?.trim();
    if (header === undefined || header.length === 0) return undefined;

    if (!isUUID(header)) {
      throw new BadRequestException('X-Player-Id must be a UUID');
    }

    return header;
  }
}
