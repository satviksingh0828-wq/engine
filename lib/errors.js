export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function publicError(err) {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message, detail: err.detail } },
    };
  }

  return {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong while processing the request." } },
  };
}

export function sendError(res, err, fallbackMessage) {
  if (!(err instanceof ApiError)) {
    console.error(fallbackMessage || "Unhandled API error", err);
  }
  const safe = publicError(err);
  return res.status(safe.status).json(safe.body);
}
