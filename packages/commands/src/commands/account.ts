import type { Command } from "../registry.js";
import type { SignupResult, VerifyEmailResult } from "@prefab/api-client";

export const accountSignup: Command<{ email: string }, SignupResult> = {
  name: "account.signup",
  mutation: "account.signup",
  description: "Start real signup: emails a 6-digit verification code (Slice 3, replaces dev/login for production users)",
  run: (ctx, args) => ctx.api.signup(args.email),
};

export const accountVerifyEmail: Command<{ email: string; code: string }, VerifyEmailResult> = {
  name: "account.verifyEmail",
  mutation: "account.verifyEmail",
  description: "Verify a signup code and start a session",
  run: (ctx, args) => ctx.api.verifyEmail(args.email, args.code),
};
