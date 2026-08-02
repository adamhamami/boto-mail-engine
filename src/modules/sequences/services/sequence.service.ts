import { NotFoundError } from "@/lib/errors";
import { getSkipTake } from "@/lib/api/pagination";
import { auditService } from "@/modules/audit/services/audit.service";
import { sequenceRepository } from "@/modules/sequences/repositories/sequence.repository";
import type {
  CreateSequenceInput,
  ListSequencesInput,
  UpdateSequenceInput,
} from "@/modules/sequences/validators/sequence.validator";

export class SequenceService {
  async list(input: ListSequencesInput) {
    const { skip, take } = getSkipTake(input.page, input.limit);
    return sequenceRepository.findMany({
      skip,
      take,
      search: input.search,
      sortOrder: input.sortOrder,
    });
  }

  async getById(id: string) {
    const sequence = await sequenceRepository.findById(id);
    if (!sequence) {
      throw new NotFoundError("Sequence", id);
    }
    return sequence;
  }

  async create(input: CreateSequenceInput, userId: string) {
    const sequence = await sequenceRepository.create(input, userId);

    await auditService.log({
      action: "CREATE",
      module: "sequences",
      entityType: "Sequence",
      entityId: sequence.id,
      userId,
      newValues: sequence,
    });

    return sequence;
  }

  async update(id: string, input: UpdateSequenceInput, userId: string) {
    const existing = await this.getById(id);
    const sequence = await sequenceRepository.update(id, input, userId);

    await auditService.log({
      action: "UPDATE",
      module: "sequences",
      entityType: "Sequence",
      entityId: sequence.id,
      userId,
      oldValues: existing,
      newValues: sequence,
    });

    return sequence;
  }

  async delete(id: string, userId: string) {
    const existing = await this.getById(id);
    const sequence = await sequenceRepository.softDelete(id, userId);

    await auditService.log({
      action: "DELETE",
      module: "sequences",
      entityType: "Sequence",
      entityId: sequence.id,
      userId,
      oldValues: existing,
    });

    return sequence;
  }
}

export const sequenceService = new SequenceService();
