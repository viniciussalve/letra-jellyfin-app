import type { FastifyReply } from "fastify";
import type { ApiError } from "../../shared/types.ts";

export function sendError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  const body: ApiError = { error: { code, message } };
  return reply.code(status).send(body);
}

/** An error with our own code and Portuguese message; the error handler passes it through. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
