import { z } from "zod";

export const apiErrorSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const errorCodes = {
  // Auth
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",

  // Setup
  SETUP_ALREADY_COMPLETE: "SETUP_ALREADY_COMPLETE",
  SETUP_REQUIRED: "SETUP_REQUIRED",

  // Profiles
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  INVALID_PIN: "INVALID_PIN",

  // Devices
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  DEVICE_LIMIT_REACHED: "DEVICE_LIMIT_REACHED",
  PAIRING_CODE_EXPIRED: "PAIRING_CODE_EXPIRED",
  PAIRING_CODE_INVALID: "PAIRING_CODE_INVALID",

  // Downloads
  DOWNLOAD_NOT_FOUND: "DOWNLOAD_NOT_FOUND",
  DEVICE_OFFLINE: "DEVICE_OFFLINE",

  // General
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
