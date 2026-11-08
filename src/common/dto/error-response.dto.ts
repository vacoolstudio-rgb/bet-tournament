import { ApiProperty } from '@nestjs/swagger';

/**
 * The error body, which is Nest's default exception shape rather than a custom
 * one: a client that already handles Nest errors needs no special case, and
 * inventing a second format for the same information is how two formats end up
 * in production.
 */
export interface ErrorResponse {
  readonly statusCode: number;
  /** A string for a thrown HttpException, an array for validation failures. */
  readonly message: string | readonly string[];
  readonly error?: string | undefined;
}

export class ErrorResponseDto implements ErrorResponse {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['limit must not be greater than 100'],
    description: 'One message, or one per failed validation rule.',
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request', required: false })
  error?: string;
}
