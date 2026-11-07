import { Schema, Types, model } from 'mongoose'

interface ResumeTemplate {
  userId: Types.ObjectId
  name: string
  fontFamily: 'Helvetica' | 'Times-Roman' | 'Courier'
  fontSize: number
  accentColor: string
  textColor: string
  backgroundColor: string
  layout: 'single-column' | 'two-column'
  createdAt: Date
  updatedAt: Date
}

const resumeTemplateSchema = new Schema<ResumeTemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    fontFamily: { type: String, enum: ['Helvetica', 'Times-Roman', 'Courier'], required: true },
    fontSize: { type: Number, min: 8, max: 14, required: true },
    accentColor: { type: String, required: true },
    textColor: { type: String, required: true },
    backgroundColor: { type: String, required: true },
    layout: { type: String, enum: ['single-column', 'two-column'], required: true },
  },
  { timestamps: true },
)

resumeTemplateSchema.index({ userId:  1, createdAt: -1 })

export const ResumeTemplateModel = model<ResumeTemplate>('ResumeTemplate', resumeTemplateSchema)
