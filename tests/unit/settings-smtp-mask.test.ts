import { describe, it, expect } from "vitest";
import { buildMaskedSmtpPublicView } from "@/modules/settings/services/settings.service";

describe("Settings SMTP public masking", () => {
  it("never returns raw SMTP host, user or password", () => {
    const smtp = buildMaskedSmtpPublicView({
      host: "smtp.secret.example",
      port: 587,
      secure: false,
      user: "secret-user",
      password: "super-secret-password",
      fromName: "BotoSchool",
      fromEmail: "noreply@botoschool.com",
    });

    expect(smtp.host).toBe("***");
    expect(smtp.user).toBe("***");
    expect(smtp.password).toBe("***");
    expect(smtp.port).toBe(587);
    expect(smtp.fromEmail).toBe("noreply@botoschool.com");
    expect(JSON.stringify(smtp)).not.toContain("smtp.secret.example");
    expect(JSON.stringify(smtp)).not.toContain("secret-user");
    expect(JSON.stringify(smtp)).not.toContain("super-secret-password");
  });

  it("returns empty strings when credentials absent", () => {
    const smtp = buildMaskedSmtpPublicView({
      host: "",
      port: 587,
      secure: true,
      user: undefined,
      password: undefined,
      fromName: "BotoSchool",
      fromEmail: "noreply@botoschool.com",
    });
    expect(smtp.host).toBe("");
    expect(smtp.user).toBe("");
    expect(smtp.password).toBe("");
  });
});
