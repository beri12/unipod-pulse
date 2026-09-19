"""Consistent API errors — never a stack trace in production."""

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse


class RecallError(HTTPException):
    """An error with a stable machine-readable code."""

    def __init__(self, code: str, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.message = message


class NotFound(RecallError):
    def __init__(self, message: str = "Not found", code: str = "NOT_FOUND"):
        super().__init__(code, message, status.HTTP_404_NOT_FOUND)


class Unauthorized(RecallError):
    def __init__(self, message: str = "Unauthorized", code: str = "UNAUTHORIZED"):
        super().__init__(code, message, status.HTTP_401_UNAUTHORIZED)


class ValidationFailed(RecallError):
    def __init__(self, message: str, code: str = "VALIDATION_FAILED"):
        super().__init__(code, message, status.HTTP_422_UNPROCESSABLE_ENTITY)


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


async def recall_error_handler(request: Request, exc: RecallError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message))


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    code = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND"}.get(
        exc.status_code, "REQUEST_FAILED"
    )
    return JSONResponse(status_code=exc.status_code, content=error_body(code, str(exc.detail)))


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    # The detail is logged, never returned: it can contain internals.
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_body("INTERNAL_ERROR", "An unexpected error occurred."),
    )
