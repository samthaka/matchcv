import { Schema, Types, model } from 'mongoose'

interface PersonalInfo {
  fullName: string | null
  email: string | null
  linkedinUrl: string | null
  githubUrl: string | null
  portfolioUrl: string | null
}

interface WorkExperience {
  company: string | null
  position: string | null
  title: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
  bullets: string[]
}

interface Education {
  institution: string | null
  award: string | null
  degree?: string | null
  fieldOfStudy: string | null
  graduationYear: number | null
}

interface ResumeTemplate {
  name: string
  fontFamily: 'Helvetica' | 'Times-Roman' | 'Courier'
  fontSize: number
  accentColor: string
  textColor: string
  backgroundColor: string
  layout: 'single-column' | 'two-column'
}

interface Resume {
  userId: Types.ObjectId
  title: string
  template: ResumeTemplate
  entryMethod: 'FORM' | 'PARSED_UPLOAD'
  fileHash: string
  contentHash: string
  professionalSummary: string
  personalInfo: PersonalInfo
  workExperience: WorkExperience[]
  education: Education[]
  skills: string[]
  rawExtractedText: string
  createdAt: Date
  updatedAt: Date
}

const personalInfoSchema = new Schema<PersonalInfo>(
  {
    fullName: { type: String, default: null },
    email: { type: String, default: null },
    linkedinUrl: { type: String, default: null },
    githubUrl: { type: String, default: null },
    portfolioUrl: { type: String, default: null },
  },
  { _id: false },
)

const workExperienceSchema = new Schema<WorkExperience>(
  {
    company: { type: String, default: null },
    position: { type: String, default: null },
    title: { type: String, default: null },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    isCurrent: { type: Boolean, required: true },
    bullets: { type: [String], default: [] },
  },
  { _id: false },
)

const educationSchema = new Schema<Education>(
  {
    institution: { type: String, default: null },
    award: { type: String, default: null },
    degree: { type: String, default: null },
    fieldOfStudy: { type: String, default: null },
    graduationYear: { type: Number, default: null },
  },
  { _id: false },
)

const resumeTemplateSchema = new Schema<ResumeTemplate>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    fontFamily: { type: String, enum: ['Helvetica', 'Times-Roman', 'Courier'], required: true },
    fontSize: { type: Number, min: 8, max: 14, required: true },
    accentColor: { type: String, required: true },
    textColor: { type: String, required: true },
    backgroundColor: { type: String, required: true },
    layout: { type: String, enum: ['single-column', 'two-column'], required: true },
  },
  { _id: false },
)

const resumeSchema = new Schema<Resume>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, default: 'My Resume' },
    template: {
      type: resumeTemplateSchema,
      default: () => ({
        name: 'Classic',
        fontFamily: 'Helvetica',
        fontSize: 10,
        accentColor: '#365fce',
        textColor: '#17213a',
        backgroundColor: '#ffffff',
        layout: 'single-column',
      }),
    },
    entryMethod: { type: String, enum: ['FORM', 'PARSED_UPLOAD'], required: true },
    fileHash: { type: String, required: true },
    contentHash: { type: String, required: true },
    professionalSummary: { type: String, default: '', maxlength: 3000 },
    personalInfo: { type: personalInfoSchema, required: true },
    workExperience: { type: [workExperienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    skills: { type: [String], default: [] },
    rawExtractedText: { type: String, default: '' },
  },
  { timestamps: true },
)

resumeSchema.index({ userId: 1, fileHash: 1 }, { unique: true })
resumeSchema.index({ userId: 1, contentHash: 1 }, { unique: true })
resumeSchema.index({ userId: 1, createdAt: -1 })

export const ResumeModel = model<Resume>('Resume', resumeSchema)
