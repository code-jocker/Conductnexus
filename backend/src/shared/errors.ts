export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message = 'Invalid request', details?: unknown) {
    return new ApiError(400, 'BAD_REQUEST', message, details)
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message)
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, 'FORBIDDEN', message)
  }
  static notFound(message = 'Record not found') {
    return new ApiError(404, 'NOT_FOUND', message)
  }
  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError(409, 'CONFLICT', message, details)
  }
  static unprocessable(message = 'Validation failed', details?: unknown) {
    return new ApiError(422, 'VALIDATION_ERROR', message, details)
  }
  static tooMany(message = 'Too many requests. Please try again later.') {
    return new ApiError(429, 'TOO_MANY_REQUESTS', message)
  }
  static internal(message = 'An unexpected error occurred') {
    return new ApiError(500, 'INTERNAL_ERROR', message)
  }
}
