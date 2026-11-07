import { Router, type Request } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/authenticate.js'
import { ResumeTemplateModel } from '../models/resume-template.js'
import { HttpError } from '../utils/http-error.js'

const router = Router()
const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  fontFamily: z.enum(['Helvetica', 'Times-Roman', 'Courier']),
  fontSize: z.number().min(8).max(14),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  layout: z.enum(['single-column', 'two-column']),
}).strict()

function getCandidateId(request: Request): Types.ObjectId {
  const userId = request.auth?.userId
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new HttpError(401, 'Authentication required')
  }
  return new Types.ObjectId(userId)
}

function getTemplateId(request: Request): Types.ObjectId {
  const id = request.params.id
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
    throw new HttpError(404, 'Template not found')
  }
  return new Types.ObjectId(id)
}

function publicTemplate(template: {
  _id: Types.ObjectId
  name: string
  fontFamily: 'Helvetica' | 'Times-Roman' | 'Courier'
  fontSize: number
  accentColor: string
  textColor: string
  backgroundColor: string
  layout: 'single-column' | 'two-column'
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: template._id.toString(),
    name: template.name,
    fontFamily: template.fontFamily,
    fontSize: template.fontSize,
    accentColor: template.accentColor,
    textColor: template.textColor,
    backgroundColor: template.backgroundColor,
    layout: template.layout,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  }
}

router.get('/', authenticate, requireRole('CANDIDATE'), async (request, response) => {
  const templates = await ResumeTemplateModel.find({ userId: getCandidateId(request) })
    .sort({ createdAt: -1 })
    .lean()
  response.json({ templates: templates.map(publicTemplate) })
})

router.post('/', authenticate, requireRole('CANDIDATE'), async (request, response) => {
  const result = templateInputSchema.safeParse(request.body)
  if (!result.success) {
    throw new HttpError(400, 'Template details are invalid', result.error.issues)
  }
  const template = await ResumeTemplateModel.create({
    userId: getCandidateId(request),
    ...result.data,
  })
  response.status(201).json({ template: publicTemplate(template) })
})

router.put('/:id', authenticate, requireRole('CANDIDATE'), async (request, response) => {
  const result = templateInputSchema.safeParse(request.body)
  if (!result.success) {
    throw new HttpError(400, 'Template details are invalid', result.error.issues)
  }
  const template = await ResumeTemplateModel.findOneAndUpdate(
    { _id: getTemplateId(request), userId: getCandidateId(request) },
    { $set: result.data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!template) {
    throw new HttpError(404, 'Template not found')
  }
  response.json({ template: publicTemplate(template) })
})

router.delete('/:id', authenticate, requireRole('CANDIDATE'), async (request, response) => {
  const template = await ResumeTemplateModel.findOneAndDelete({
    _id: getTemplateId(request),
    userId: getCandidateId(request),
  })
  if (!template) {
    throw new HttpError(404, 'Template not found')
  }
  response.status(204).end()
})

export { router as templatesRouter }
