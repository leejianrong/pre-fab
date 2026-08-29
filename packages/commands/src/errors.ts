/** R13's exit-code contract: 0 ok, 1 user error, 2 conflict, 3 auth, 4 upstream. */
export type ExitCode = 0 | 1 | 2 | 3 | 4;

export type CommandErrorKind = "user_error" | "conflict" | "auth" | "upstream";

const EXIT_CODE_BY_KIND: Record<CommandErrorKind, ExitCode> = {
  user_error: 1,
  conflict: 2,
  auth: 3,
  upstream: 4,
};

export class CommandError extends Error {
  readonly kind: CommandErrorKind;
  readonly exitCode: ExitCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(kind: CommandErrorKind, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CommandError";
    this.kind = kind;
    this.exitCode = EXIT_CODE_BY_KIND[kind];
    this.code = code;
    this.details = details;
  }
}

/** Maps an ApiClientError's server-assigned `code` onto R13's kinds. */
export function commandErrorFromApiCode(code: string, status: number, message: string, details?: unknown): CommandError {
  switch (code) {
    case "conflict":
      return new CommandError("conflict", code, message, details);
    case "unauthorized":
    case "forbidden":
      return new CommandError("auth", code, message, details);
    // Slice 8's plan gate: actionable by the caller (upgrade the plan),
    // the same R13 kind as a validation error, never "upstream" — nothing
    // failed on our end.
    case "validation_error":
    case "not_found":
    case "plan_required":
      return new CommandError("user_error", code, message, details);
    default:
      return new CommandError("upstream", code || "internal", message, details);
  }
}
