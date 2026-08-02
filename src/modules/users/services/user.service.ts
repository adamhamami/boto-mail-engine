import bcrypt from "bcryptjs";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { auditService } from "@/modules/audit/services/audit.service";
import { userRepository } from "@/modules/users/repositories/user.repository";
import type {
  CreateUserInput,
  ListUsersInput,
  UpdateUserInput,
} from "@/modules/users/validators/user.validator";
import { getSkipTake } from "@/lib/api/pagination";

export class UserService {
  async list(input: ListUsersInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return userRepository.findMany({
      skip,
      take,
      search: input.search,
      status: input.status,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError("User", id);
    }
    return user;
  }

  async create(input: CreateUserInput, actorId: string) {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError(`User with email '${input.email}' already exists`);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await userRepository.create({ ...input, passwordHash });

    await auditService.log({
      action: "CREATE",
      module: "users",
      entityType: "User",
      entityId: user.id,
      userId: actorId,
      newValues: { email: user.email, name: user.name, status: user.status },
    });

    return user;
  }

  async update(id: string, input: UpdateUserInput, actorId: string) {
    const existing = await this.getById(id);

    if (input.email) {
      const emailTaken = await userRepository.findByEmail(input.email, id);
      if (emailTaken) {
        throw new ConflictError(`User with email '${input.email}' already exists`);
      }
    }

    const passwordHash = input.password
      ? await bcrypt.hash(input.password, 12)
      : undefined;

    const user = await userRepository.update(id, {
      ...input,
      passwordHash,
    });

    await auditService.log({
      action: "UPDATE",
      module: "users",
      entityType: "User",
      entityId: user.id,
      userId: actorId,
      oldValues: { email: existing.email, name: existing.name, status: existing.status },
      newValues: { email: user.email, name: user.name, status: user.status },
    });

    return user;
  }

  async delete(id: string, actorId: string) {
    const existing = await this.getById(id);
    const user = await userRepository.softDelete(id);

    await auditService.log({
      action: "DELETE",
      module: "users",
      entityType: "User",
      entityId: user.id,
      userId: actorId,
      oldValues: { email: existing.email, name: existing.name },
    });

    return user;
  }

  async listRoles() {
    return userRepository.listRoles();
  }
}

export const userService = new UserService();
