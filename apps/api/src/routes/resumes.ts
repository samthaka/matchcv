import { createHash, randomUUID } from 'node:crypto'
import multer from 'multer'
import { Router, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Types } from 'mongoose'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/authenticate.js'
import { ResumeModel } from '../models/resume.js'
import { extractResumeText, structureResumeText } from '../services/resume-parser.js'
import { renderResumePdf } from '../services/resume-pdf.js'
import { HttpError } from '../utils/http-error.js'

const router = Router()
const maxFileSize = 5 * 1024 * 1024
const pdfMimeType = 'application/pdf'
const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const textField = z.string().trim().max(2000).nullable()
const resumeInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  personalInfo: z.object({
    fullName: textField,
    email: z.string().trim().email().max(320).nullable(),
    phone: textField,
    location: textField,
    linkedinUrl: textField,
    githubUrl: textField,
  }).strict(),
  workExperience: z.array(z.object({
    company: textField,
    position: textField,
    title: textField,
    startDate: textField,
    endDate: textField,
    isCurrent: z.boolean(),
    bullets: z.array(z.string().trim().min(1).max(2000)).max(30),
  }).strict()).max(50),
  education: z.array(z.object({
    institution: textField,
    award: textField,
    fieldOfStudy: textField,
    graduationYear: z.number().int().min(1900).max(2200).nullable(),
  }).strict()).max(30),
  skills: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict()

type ResumeInput = z.infer<typeof resumeInputSchema>

const parseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many resume parsing attempts. Try again later.' },
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize, files: 1, fields: 0, parts: 1 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype !== pdfMimeType && file.mimetype !== docxMimeType) {
      callback(new HttpError(415, 'Only PDF and DOCX resumes are supported'))
      return
    }
    callback(null, true)
  },
})

const uploadResume: RequestHandler = (request, response, next) => {
  upload.single('file')(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(new HttpError(413, 'Resume file must be 5 MB or smaller'))
        return
      }
      next(new HttpError(400, 'Upload one resume using the file field'))
      return
    }
    next(error)
  })
}

function hasExpectedSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === pdfMimeType) {
    return buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))
  }

  return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
}

function getCandidateId(request: Parameters<RequestHandler>[0]): Types.ObjectId {
  const userId = request.auth?.userId
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new HttpError(401, 'Authentication required')
  }
  return new Types.ObjectId(userId)
}

function hashFile(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function hashExtractedText(text: string): string {
  const normalizedText = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalizedText, 'utf8').digest('hex')
}

function generateUniqueResumeHash(): string {
  return createHash('sha256').update(randomUUID()).digest('hex')
}

function parseResumeInput(body: unknown): ResumeInput {
  const result = resumeInputSchema.safeParse(body)
  if (!result.success) {
    throw new HttpError(400, 'Resume details are invalid', result.error.issues)
  }
  return result.data
}

function getResumeId(request: Parameters<RequestHandler>[0]): Types.ObjectId {
  const id = request.params.id
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
    throw new HttpError(404, 'Resume not found')
  }
  return new Types.ObjectId(id)
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

function duplicateResumeError(): HttpError {
  return new HttpError(409, 'This resume has already been uploaded and processed')
}

function normalizedWorkExperience(experience: {
  company: string | null
  position: string | null
  title: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
  bullets: string[]
}) {
  return {
    company: experience.company,
    position: experience.position,
    title: experience.title,
    startDate: experience.startDate,
    endDate: experience.endDate,
    isCurrent: experience.isCurrent,
    bullets: experience.bullets,
  }
}

function normalizedEducation(education: {
  institution: string | null
  award: string | null
  degree?: string | null
  fieldOfStudy: string | null
  graduationYear: number | null
}) {
  return {
    institution: education.institution,
    award: education.award ?? education.degree ?? null,
    fieldOfStudy: education.fieldOfStudy,
    graduationYear: education.graduationYear,
  }
}

function publicResume(resume: {
  _id: Types.ObjectId
  title: string
  entryMethod: 'FORM' | 'PARSED_UPLOAD'
  personalInfo: {
    fullName: string | null
    email: string | null
    phone: string | null
    location: string | null
    linkedinUrl: string | null
    githubUrl: string | null
  }
  workExperience: Array<{
    company: string | null
    position: string | null
    title: string | null
    startDate: string | null
    endDate: string | null
    isCurrent: boolean
    bullets: string[]
  }>
  education: Array<{
    institution: string | null
    award: string | null
    degree?: string | null
    fieldOfStudy: string | null
    graduationYear: number | null
  }>
  skills: string[]
  rawExtractedText: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: resume._id.toString(),
    title: resume.title,
    entryMethod: resume.entryMethod,
    personalInfo: resume.personalInfo,
    workExperience: resume.workExperience.map(normalizedWorkExperience),
    education: resume.education.map(normalizedEducation),
    skills: resume.skills,
    rawExtractedText: resume.rawExtractedText,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  }
}

router.get(
  '/',
  authenticate,
  requireRole('CANDIDATE'),
  async (request, response) => {
    const userId = getCandidateId(request)
    const resumes = await ResumeModel.find({ userId }).sort({ createdAt: -1 }).lean()
    response.json({ resumes: resumes.map(publicResume) })
  },
)

router.post(
  '/',
  authenticate,
  requireRole('CANDIDATE'),
  async (request, response) => {
    const userId = getCandidateId(request)
    const input = parseResumeInput(request.body)
    const savedResume = await ResumeModel.create({
      userId,
      ...input,
      entryMethod: 'FORM',
      fileHash: generateUniqueResumeHash(),
      contentHash: generateUniqueResumeHash(),
      rawExtractedText: '',
    })
    response.status(201).json({ resume: publicResume(savedResume) })
  },
)

router.post(
  '/parse-file',
  authenticate,
  requireRole('CANDIDATE'),
  parseLimiter,
  uploadResume,
  async (request, response) => {
    const file = request.file
    if (!file) {
      throw new HttpError(400, 'Choose a PDF or DOCX resume to upload')
    }
    if (!hasExpectedSignature(file.buffer, file.mimetype)) {
      throw new HttpError(415, 'The uploaded file does not match its declared type')
    }

    const userId = getCandidateId(request)
    const fileHash = hashFile(file.buffer)
    const existingFile = await ResumeModel.exists({ userId, fileHash })
    if (existingFile) {
      throw duplicateResumeError()
    }

    let rawExtractedText: string
    try {
      rawExtractedText = (await extractResumeText(file.buffer, file.mimetype)).trim()
    } catch (error) {
      if (error instanceof HttpError) {
        throw error
      }
      throw new HttpError(422, 'Could not extract text from this document', undefined, {
        cause: error,
      })
    }
    if (!rawExtractedText) {
      throw new HttpError(422, 'No readable text was found in this document')
    }

    const contentHash = hashExtractedText(rawExtractedText)
    const existingContent = await ResumeModel.exists({ userId, contentHash })
    if (existingContent) {
      throw duplicateResumeError()
    }

    const structuredResume = await structureResumeText(rawExtractedText)
    try {
      const savedResume = await ResumeModel.create({
        userId,
        title: structuredResume.personalInfo.fullName
          ? `${structuredResume.personalInfo.fullName}'s Resume`
          : 'My Resume',
        entryMethod: 'PARSED_UPLOAD',
        fileHash,
        contentHash,
        ...structuredResume,
        rawExtractedText,
      })
      response.status(201).json({ resume: publicResume(savedResume) })
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw duplicateResumeError()
      }
      throw error
    }
  },
)

router.get(
  '/:id/export-pdf',
  authenticate,
  requireRole('CANDIDATE'),
  async (request, response) => {
    const userId = getCandidateId(request)
    const resumeId = getResumeId(request)
    const resume = await ResumeModel.findOne({ _id: resumeId, userId }).lean()
    if (!resume) {
      throw new HttpError(404, 'Resume not found')
    }

    const pdf = await renderResumePdf({
      ...resume,
      workExperience: resume.workExperience.map(normalizedWorkExperience),
      education: resume.education.map(normalizedEducation),
    })
    const fileName = (resume.personalInfo.fullName || resume.title)
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'resume'
    response
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="${fileName}.pdf"`)
      .send(pdf)
  },
)

router.get(
  '/:id',
  authenticate,
  requireRole('CANDIDATE'),
  async (request, response) => {
    const userId = getCandidateId(request)
    const resumeId = getResumeId(request)
    const resume = await ResumeModel.findOne({ _id: resumeId, userId }).lean()
    if (!resume) {
      throw new HttpError(404, 'Resume not found')
    }
    response.json({ resume: publicResume(resume) })
  },
)

router.put(
  '/:id',
  authenticate,
  requireRole('CANDIDATE'),
  async (request, response) => {
    const userId = getCandidateId(request)
    const resumeId = getResumeId(request)
    const input = parseResumeInput(request.body)
    const resume = await ResumeModel.findOneAndUpdate(
      { _id: resumeId, userId },
      { $set: input },
      { returnDocument: 'after', runValidators: true },
    )
    if (!resume) {
      throw new HttpError(404, 'Resume not found')
    }
    response.json({ resume: publicResume(resume) })
  },
)

export { router as resumesRouter }
