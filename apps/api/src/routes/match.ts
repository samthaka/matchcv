import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Types } from 'mongoose'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/authenticate.js'
import { ResumeModel } from '../models/resume.js'
import { analyzeResumeMatch } from '../services/match-analysis.js'
import { HttpError } from '../utils/http-error.js'

const router = Router()
const analysisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many match analysis attempts. Try again later.' },
})
const requestSchema = z.object({
  resumeId: z.string().regex(/^[a-f\d]{24}$/i),
  jobDescriptionText: z.string().trim().min(1).max(20_000),
}).strict()

router.post(
  '/analyze',
  authenticate,
  requireRole('CANDIDATE'),
  analysisLimiter,
  async (request, response) => {
    const input = requestSchema.safeParse(request.body)
    if (!input.success) {
      throw new HttpError(400, 'Match analysis details are invalid', input.error.issues)
    }

    const userId = request.auth?.userId
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new HttpError(401, 'Authentication required')
    }

    const resume = await ResumeModel.findOne({
      _id: input.data.resumeId,
      userId: new Types.ObjectId(userId),
    }).lean()
    if (!resume) {
      throw new HttpError(404, 'Resume not found')
    }

    const result = await analyzeResumeMatch(resume, input.data.jobDescriptionText)
    response.json(result)
  },
)

export { router as matchRouter }
