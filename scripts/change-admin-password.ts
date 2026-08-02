/**
 * Change the admin user password.
 *
 * Usage:
 *   npx tsx scripts/change-admin-password.ts "NewStrongPassword!"
 *   ADMIN_PASSWORD="..." npx tsx scripts/change-admin-password.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db/prisma";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@botoschool.com";

async function main() {
  const password =
    process.argv[2] ?? process.env.ADMIN_PASSWORD ?? process.env.NEW_ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    console.error(
      "Usage: npx tsx scripts/change-admin-password.ts \"YourPasswordMin12Chars\"",
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.update({
    where: { email: ADMIN_EMAIL },
    data: { passwordHash, status: "ACTIVE" },
    select: { id: true, email: true, name: true },
  });

  console.log(`✅ Password updated for ${user.email} (${user.id})`);
}

main()
  .catch((err) => {
    console.error("❌ Failed to update admin password:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
