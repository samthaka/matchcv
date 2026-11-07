import { Schema, model } from 'mongoose'

export type SkillCategory = 'hard_skill' | 'soft_skill' | 'tool'

export interface SkillTaxonomy {
  canonicalId: string
  canonicalName: string
  aliases: string[]
  category: SkillCategory
  source: string
}

const skillTaxonomySchema = new Schema<SkillTaxonomy>(
  {
    canonicalId: { type: String, required: true, unique: true, index: true },
    canonicalName: { type: String, required: true, index: true },
    aliases: { type: [String], default: [] },
    category: {
      type: String,
      enum: ['hard_skill', 'soft_skill', 'tool'],
      default: 'hard_skill',
      required: true,
    },
    source: { type: String, default: 'O*NET 31.0 Database', required: true },
  },
  { timestamps: true },
)

skillTaxonomySchema.index({ aliases: 1 })

export const SkillTaxonomyModel = model<SkillTaxonomy>('SkillTaxonomy', skillTaxonomySchema)
