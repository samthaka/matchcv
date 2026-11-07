import 'dotenv/config'
import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import { getMongoUri } from '../src/config.js'
import { SkillTaxonomyModel } from '../src/models/skill-taxonomy.js'
import {
  planAliasAdditions,
  normalizeSkillTerm,
  skillAliasUpdateSchema,
  skillTaxonomyRecordSchema,
  validateTaxonomyRecords,
  type ExistingSkillRecord,
  type SkillAliasUpdate,
  type SkillTaxonomyRecord,
} from '../src/services/skill-taxonomy-sync.js'

dotenv.config({ path: '../../.env' })

const batchSize = 250

function parseArguments(args: string[]): {
  seedPath?: string | undefined
  aliasesPath?: string | undefined
  apply: boolean
} {
  let seedPath: string | undefined
  let aliasesPath: string | undefined
  let apply = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--apply') {
      apply = true
    } else if (argument === '--seed' || argument === '--aliases') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Expected a file path after ${argument}`)
      }
      if (argument === '--seed') {
        seedPath = value
      } else {
        aliasesPath = value
      }
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (!seedPath && !aliasesPath) {
    throw new Error('Provide --seed <file>, --aliases <file>, or both')
  }

  return { seedPath, aliasesPath, apply }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function parseSeed(value: unknown): SkillTaxonomyRecord[] {
  const result = skillTaxonomyRecordSchema.array().safeParse(value)
  if (!result.success) {
    throw new Error(`Invalid taxonomy seed: ${result.error.message}`)
  }
  validateTaxonomyRecords(result.data)
  return result.data
}

function parseAliasUpdates(value: unknown): SkillAliasUpdate[] {
  const result = skillAliasUpdateSchema.array().safeParse(value)
  if (!result.success) {
    throw new Error(`Invalid alias update file: ${result.error.message}`)
  }
  return result.data
}

async function verifySeedAgainstDatabase(records: SkillTaxonomyRecord[]): Promise<void> {
  const existing = await SkillTaxonomyModel.find()
    .select({ canonicalId: 1, canonicalName: 1, aliases: 1 })
    .lean<ExistingSkillRecord[]>()
  const recordsById = new Map(existing.map((record) => [record.canonicalId, record]))
  const namesByTerm = new Map<string, string>()
  for (const record of existing) {
    for (const term of [record.canonicalName, ...(record.aliases ?? [])]) {
      const normalizedTerm = normalizeSkillTerm(term)
      const owner = namesByTerm.get(normalizedTerm)
      if (owner && owner !== record.canonicalId) {
        throw new Error(`Existing taxonomy term "${term}" has multiple canonical owners`)
      }
      namesByTerm.set(normalizedTerm, record.canonicalId)
    }
  }

  for (const record of records) {
    const idMatch = recordsById.get(record.canonicalId)
    if (idMatch && idMatch.canonicalName !== record.canonicalName) {
      throw new Error(
        `Seed canonicalId "${record.canonicalId}" already has a different canonicalName`,
      )
    }
    for (const term of [record.canonicalName, ...record.aliases]) {
      const normalizedTerm = normalizeSkillTerm(term)
      const termOwner = namesByTerm.get(normalizedTerm)
      if (termOwner && termOwner !== record.canonicalId) {
        throw new Error(`Seed taxonomy term "${term}" already belongs to a different ID`)
      }
      namesByTerm.set(normalizedTerm, record.canonicalId)
    }
  }
}

async function syncSeed(
  records: SkillTaxonomyRecord[],
  apply: boolean,
): Promise<void> {
  await verifySeedAgainstDatabase(records)
  console.info(`Validated ${records.length} taxonomy records.`)
  if (!apply) {
    console.info('Dry run only. Re-run with --apply to write the seed to MongoDB.')
    return
  }

  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = records.slice(offset, offset + batchSize)
    await SkillTaxonomyModel.bulkWrite(batch.map((record) => ({
      updateOne: {
        filter: { canonicalId: record.canonicalId },
        update: {
          $setOnInsert: {
            canonicalId: record.canonicalId,
            canonicalName: record.canonicalName,
            category: record.category,
            source: record.source,
          },
          $addToSet: { aliases: { $each: record.aliases } },
        },
        upsert: true,
      },
    })), { ordered: true })
    console.info(`Imported ${Math.min(offset + batch.length, records.length)}/${records.length}`)
  }
}

async function loadExistingRecords(): Promise<ExistingSkillRecord[]> {
  return SkillTaxonomyModel.find()
    .select({ canonicalId: 1, canonicalName: 1, aliases: 1 })
    .lean<ExistingSkillRecord[]>()
}

async function syncAliases(updates: SkillAliasUpdate[], apply: boolean): Promise<void> {
  const additions = planAliasAdditions(await loadExistingRecords(), updates)
  const count = additions.reduce((total, update) => total + update.aliases.length, 0)
  console.info(`Validated ${count} new aliases across ${additions.length} skills.`)
  if (!apply) {
    console.info('Dry run only. Re-run with --apply to add these aliases.')
    return
  }

  for (let offset = 0; offset < additions.length; offset += batchSize) {
    const batch = additions.slice(offset, offset + batchSize)
    await SkillTaxonomyModel.bulkWrite(batch.map((addition) => ({
      updateOne: {
        filter: { canonicalId: addition.canonicalId },
        update: { $addToSet: { aliases: { $each: addition.aliases } } },
      },
    })), { ordered: true })
    console.info(`Updated ${Math.min(offset + batch.length, additions.length)}/${additions.length} skills`)
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const seed = options.seedPath ? parseSeed(await readJson(options.seedPath)) : undefined
  const aliasUpdates = options.aliasesPath
    ? parseAliasUpdates(await readJson(options.aliasesPath))
    : undefined

  await mongoose.connect(getMongoUri())
  try {
    await SkillTaxonomyModel.init()
    if (seed) {
      await syncSeed(seed, options.apply)
    }
    if (aliasUpdates) {
      await syncAliases(aliasUpdates, options.apply)
    }
  } finally {
    await mongoose.disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Failed to sync skill taxonomy', error)
  process.exitCode = 1
})
