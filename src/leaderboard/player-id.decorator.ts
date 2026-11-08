import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

export const PLAYER_ID_HEADER = 'x-player-id';

/**
 * Reads the caller's player id from `X-Player-Id`.
 *
 * A custom decorator rather than `@Headers()` because that one takes no
 * pipes, and this value needs validating: `@PlayerId(PlayerIdPipe)`.
 */
export const PlayerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const value = request.headers[PLAYER_ID_HEADER];

    return Array.isArray(value) ? value[0] : value;
  },
);
