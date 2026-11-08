import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { NotImplementedError } from '../common/not-implemented.error.js';

/**
 * Validates the `X-Player-Id` header.
 *
 * Absent is allowed and yields undefined — the leaderboard is public and the
 * caller simply gets no `me` block. Present but not a UUID is a client error,
 * because silently ignoring a malformed id would answer "you have no points"
 * to a player who does.
 *
 * This is identification, not authentication: the header is trusted because
 * the task specifies it. In production the id comes from a verified token, and
 * that note belongs in the README rather than in a comment nobody reads.
 */
@Injectable()
export class PlayerIdPipe implements PipeTransform<string | undefined, string | undefined> {
  transform(_value: string | undefined): string | undefined {
    throw new NotImplementedError('PlayerIdPipe.transform');
  }
}
