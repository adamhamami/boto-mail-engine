import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyDockerSecretFiles } from "@/lib/config/docker-secrets";

describe("Phase 7 — Docker secrets *_FILE", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bs-secrets-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads AUTH_SECRET from AUTH_SECRET_FILE", () => {
    const file = path.join(dir, "auth.txt");
    fs.writeFileSync(file, "super-secret-value-from-file-32chars!!\n");
    const env: Record<string, string | undefined> = {
      AUTH_SECRET_FILE: file,
      AUTH_SECRET: "ignored",
    };
    applyDockerSecretFiles(env);
    expect(env.AUTH_SECRET).toBe("super-secret-value-from-file-32chars!!");
  });

  it("builds DATABASE_URL from POSTGRES_* + password file", () => {
    const file = path.join(dir, "pg.txt");
    fs.writeFileSync(file, "s3cret\n");
    const env: Record<string, string | undefined> = {
      POSTGRES_PASSWORD_FILE: file,
      POSTGRES_USER: "botoschool",
      POSTGRES_DB: "botoschool_email",
      POSTGRES_HOST: "postgres",
    };
    applyDockerSecretFiles(env);
    expect(env.DATABASE_URL).toContain("postgresql://botoschool:s3cret@postgres:5432/botoschool_email");
  });

  it("throws if secret file is missing", () => {
    const env: Record<string, string | undefined> = {
      AUTH_SECRET_FILE: path.join(dir, "missing.txt"),
    };
    expect(() => applyDockerSecretFiles(env)).toThrow(/AUTH_SECRET_FILE/);
  });
});
