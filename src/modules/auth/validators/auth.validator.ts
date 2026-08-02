import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Adresse email invalide"),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

export type LoginInput = z.infer<typeof loginSchema>;
