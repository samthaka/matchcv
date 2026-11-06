import { z } from 'zod'

export const skillTaxonomyRecordSchema = z.object({
  canonicalId: z.string().trim().min(1),
  canonicalName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
  category: z.enum(['hard_skill', 'soft_skill', 'tool']),
  source: z.string().trim().min(1),
}).strict()

export const skillAliasUpdateSchema = z.object({
  canonicalId: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).min(1),
}).strict()

export type SkillTaxonomyRecord = z.infer<typeof skillTaxonomyRecordSchema>
export type SkillAliasUpdate = z.infer<typeof skillAliasUpdateSchema>

export interface ExistingSkillRecord {
  canonicalId: string
  canonicalName: string
  aliases: string[]
}

export interface PlannedAliasAddition {
  canonicalId: string
  aliases: string[]
}

export function normalizeSkillTerm(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()
}

export function validateTaxonomyRecords(records: SkillTaxonomyRecord[]): void {
  const ids = new Set<string>()
  const names = new Map<string, string>()
  const terms = new Map<string, string>()

  for (const record of records) {
    if (ids.has(record.canonicalId)) {
      throw new Error(`Duplicate canonicalId in input: ${record.canonicalId}`)
    }
    ids.add(record.canonicalId)

    const normalizedName = normalizeSkillTerm(record.canonicalName)
    const existingNameId = names.get(normalizedName)
    if (existingNameId && existingNameId !== record.canonicalId) {
      throw new Error(
        `Canonical name "${record.canonicalName}" conflicts with another input record`,
      )
    }
    names.set(normalizedName, record.canonicalId)

    for (const term of [record.canonicalName, ...(record.aliases ?? [])]) {
      const normalizedTerm = normalizeSkillTerm(term)
      const existingTermId = terms.get(normalizedTerm)
      if (existingTermId && existingTermId !== record.canonicalId) {
        throw new Error(`Taxonomy term "${term}" belongs to multiple canonical records`)
      }
      terms.set(normalizedTerm, record.canonicalId)
    }
  }
}

export function planAliasAdditions(
  existingRecords: ExistingSkillRecord[],
  updates: SkillAliasUpdate[],
): PlannedAliasAddition[] {
  const recordsById = new Map<string, ExistingSkillRecord>()
  const termOwners = new Map<string, string>()

  for (const record of existingRecords) {
    if (recordsById.has(record.canonicalId)) {
      throw new Error(`Duplicate canonicalId in database: ${record.canonicalId}`)
    }
    recordsById.set(record.canonicalId, record)

    for (const term of [record.canonicalName, ...(record.aliases ?? [])]) {
      const normalizedTerm = normalizeSkillTerm(term)
      const owner = termOwners.get(normalizedTerm)
      if (owner && owner !== record.canonicalId) {
        throw new Error(`Existing taxonomy term "${term}" has multiple canonical owners`)
      }
      termOwners.set(normalizedTerm, record.canonicalId)
    }
  }

  const updatesById = new Map<string, Map<string, string>>()
  for (const update of updates) {
    const record = recordsById.get(update.canonicalId)
    if (!record) {
      throw new Error(`Unknown canonicalId in alias update: ${update.canonicalId}`)
    }

    const aliases = updatesById.get(update.canonicalId) ?? new Map<string, string>()
    for (const alias of update.aliases) {
      const normalizedAlias = normalizeSkillTerm(alias)
      if (normalizedAlias === normalizeSkillTerm(record.canonicalName)) {
        continue
      }
      const owner = termOwners.get(normalizedAlias)
      if (owner && owner !== update.canonicalId) {
        throw new Error(
          `Alias "${alias}" already belongs to canonicalId "${owner}"`,
        )
      }
      termOwners.set(normalizedAlias, update.canonicalId)
      aliases.set(normalizedAlias, alias.trim().normalize('NFKC').replace(/\s+/g, ' '))
    }
    updatesById.set(update.canonicalId, aliases)
  }

  return [...updatesById.entries()]
    .map(([canonicalId, aliases]) => ({
      canonicalId,
      aliases: [...aliases.values()].filter((alias) => {
        const existing = recordsById.get(canonicalId)?.aliases ?? []
        const normalizedAlias = normalizeSkillTerm(alias)
        return !existing.some((value) => normalizeSkillTerm(value) === normalizedAlias)
      }),
    }))
    .filter((update) => update.aliases.length > 0)
}
