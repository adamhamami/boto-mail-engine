import { z } from "zod";
import { paginationSchema } from "@/lib/api/pagination";
import { UserStatus } from "@/generated/prisma/client";

export const createUserSchema = z.object({
  email: z.string().email("Email invalide").max(255),
  name: z.string().min(1, "Le nom est requis").max(255),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères")
    .max(128),
  status: z.nativeEnum(UserStatus).optional().default(UserStatus.ACTIVE),
  roleIds: z
    .array(z.string().cuid())
    .min(1, "Au moins un rôle est requis"),
});

export const updateUserSchema = z.object({
  email: z.string().email("Email invalide").max(255).optional(),
  name: z.string().min(1, "Le nom est requis").max(255).optional(),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères")
    .max(128)
    .optional(),
  status: z.nativeEnum(UserStatus).optional(),
  roleIds: z.array(z.string().cuid()).optional(),
});

export const listUsersSchema = paginationSchema.extend({
  status: z.nativeEnum(UserStatus).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
