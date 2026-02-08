import { constants } from 'http2';

export default class ForbiddenError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.statusCode = constants.HTTP_STATUS_FORBIDDEN;
    this.name = 'ForbiddenError';
  }
}