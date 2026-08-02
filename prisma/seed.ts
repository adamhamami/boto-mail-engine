import { prisma } from "@/lib/db/prisma";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "@/lib/auth/permissions";
import bcrypt from "bcryptjs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

async function main() {
  console.log("🌱 Seeding database...");

  const permissionEntries = Object.entries(PERMISSIONS).map(([, slug]) => ({
    slug,
    name: slug.replace(/:/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    module: slug.split(":")[0] ?? "general",
    description: `Permission: ${slug}`,
  }));

  for (const perm of permissionEntries) {
    await prisma.permission.upsert({
      where: { slug: perm.slug },
      update: {},
      create: perm,
    });
  }

  const roleDefinitions = [
    {
      slug: ROLES.ADMIN,
      name: "Administrateur",
      description: "Accès complet à la plateforme",
      isSystem: true,
    },
    {
      slug: ROLES.CAMPAIGN_MANAGER,
      name: "Responsable campagne",
      description: "Import, segmentation, création et validation des campagnes",
      isSystem: true,
    },
    {
      slug: ROLES.SALES,
      name: "Commercial",
      description: "Consultation des réponses et qualification",
      isSystem: true,
    },
    {
      slug: ROLES.AUDITOR,
      name: "Auditeur",
      description: "Lecture des journaux et exports",
      isSystem: true,
    },
  ];

  for (const roleDef of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { slug: roleDef.slug },
      update: {},
      create: roleDef,
    });

    const permissions =
      ROLE_PERMISSIONS[roleDef.slug as keyof typeof ROLE_PERMISSIONS];
    for (const permSlug of permissions) {
      const permission = await prisma.permission.findUnique({
        where: { slug: permSlug },
      });
      if (permission) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: permission.id,
          },
        });
      }
    }
  }

  const adminRole = await prisma.role.findUnique({
    where: { slug: ROLES.ADMIN },
  });

  if (adminRole) {
    const fromEnv = process.env.ADMIN_SEED_PASSWORD?.trim();
    if (fromEnv && fromEnv.length < 12) {
      throw new Error("ADMIN_SEED_PASSWORD must be at least 12 characters");
    }
    const seedPassword = fromEnv || randomBytes(18).toString("base64url");
    const passwordHash = await bcrypt.hash(seedPassword, 12);

    const admin = await prisma.user.upsert({
      where: { email: "admin@botoschool.com" },
      update: {},
      create: {
        email: "admin@botoschool.com",
        name: "Administrateur",
        passwordHash,
        status: "ACTIVE",
      },
    });

    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: admin.id, roleId: adminRole.id },
      },
      update: {},
      create: { userId: admin.id, roleId: adminRole.id },
    });

    const credentialsPath = join(process.cwd(), ".credentials.local");
    appendFileSync(
      credentialsPath,
      `\n# Seed admin ${new Date().toISOString()}\nADMIN_EMAIL=admin@botoschool.com\n`,
      "utf8",
    );
    if (!fromEnv) {
      appendFileSync(
        credentialsPath,
        `ADMIN_SEED_PASSWORD_GENERATED=${seedPassword}\n# Change immediately: npm run admin:password "NouveauMotDePasseFort"\n`,
        "utf8",
      );
    }

    console.log("✅ Seed completed");
    console.log("   Admin email: admin@botoschool.com");
    console.log(
      "   Password: see .credentials.local (or ADMIN_SEED_PASSWORD env)",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
