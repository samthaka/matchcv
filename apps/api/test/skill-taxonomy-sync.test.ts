import { describe, expect, it } from 'vitest'
import {
  normalizeSkillTerm,
  planAliasAdditions,
  validateTaxonomyRecords,
  type ExistingSkillRecord,
} from '../src/services/skill-taxonomy-sync.js'

const existingRecords: ExistingSkillRecord[] = [
  { canonicalId: 'css', canonicalName: 'Cascading Style Sheets', aliases: ['CSS'] },
  { canonicalId: 'javascript', canonicalName: 'JavaScript', aliases: ['JS'] },
]

describe('skill taxonomy synchronization', () => {
  it('normalizes casing, Unicode compatibility, and whitespace for term comparisons', () => {
    expect(normalizeSkillTerm('  ＣＳＳ   ')).toBe('css')
  })

  it('plans only new aliases and is safe to run repeatedly', () => {
    const updates = [{ canonicalId: 'css', aliases: ['CSS', 'Cascading   Style Sheets'] }]

    expect(planAliasAdditions(existingRecords, updates)).toEqual([])
  })

  it('adds new aliases to the requested canonical skill', () => {
    expect(planAliasAdditions(existingRecords, [
      { canonicalId: 'javascript', aliases: ['Java Script', ' Java   Script '] },
    ])).toEqual([
      { canonicalId: 'javascript', aliases: ['Java Script'] },
    ])
  })

  it('rejects aliases already owned by a different canonical skill', () => {
    expect(() => planAliasAdditions(existingRecords, [
      { canonicalId: 'css', aliases: ['JS'] },
    ])).toThrow('already belongs to canonicalId "javascript"')
  })

  it('rejects unknown canonical IDs before writing', () => {
    expect(() => planAliasAdditions(existingRecords, [
      { canonicalId: 'unknown', aliases: ['New alias'] },
    ])).toThrow('Unknown canonicalId')
  })

  it('rejects conflicting names or aliases in an import batch', () => {
    expect(() => validateTaxonomyRecords([
      {
        canonicalId: 'first',
        canonicalName: 'JavaScript',
        aliases: [],
        category: 'hard_skill',
        source: 'curated',
      },
      {
        canonicalId: 'second',
        canonicalName: 'TypeScript',
        aliases: [' javascript '],
        category: 'hard_skill',
        source: 'curated',
      },
    ])).toThrow('belongs to multiple canonical records')
  })
})
