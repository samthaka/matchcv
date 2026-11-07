import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { SignJWT } from 'jose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { extractResumeTextMock, structureResumeTextMock } = vi.hoisted(() => ({
  extractResumeTextMock: vi.fn(),
  structureResumeTextMock: vi.fn(),
}))

vi.mock('../src/services/resume-parser.js', () => ({
  extractResumeText: extractResumeTextMock,
  structureResumeText: structureResumeTextMock,
}))

import { app } from '../src/app.js'
import { ResumeModel } from '../src/models/resume.js'
import { ResumeTemplateModel } from '../src/models/resume-template.js'
import { SkillTaxonomyModel } from '../src/models/skill-taxonomy.js'
import {
  calculateWeightedMatchScore,
  clearSkillTaxonomyCache,
} from '../src/services/groq-match-prepass.js'

const accessSecretValue = 'test-access-secret-value-with-at-least-32-bytes'
const accessSecret = new TextEncoder().encode(accessSecretValue)
const pdfMimeType = 'application/pdf'
const candidateId = new mongoose.Types.ObjectId()
const initialGeminiApiKey = process.env.GEMINI_API_KEY
const initialGeminiModel = process.env.GEMINI_MODEL
const initialGroqApiKey = process.env.GROQ_API_KEY
const initialGroqModel = process.env.GROQ_MODEL
let mongoServer: MongoMemoryServer
let requestNumber = 0

function groqCompletion(analysis: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(analysis) } }],
  }))
}

function geminiCompletion(rewrittenBullet = 'Built React applications using TypeScript'): Response {
  return new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            matchedHardSkills: ['React', 'TypeScript'],
            missingCriticalKeywords: ['Accessibility'],
            bulletPointRewrites: [{
              originalBullet: 'Built React applications using TypeScript',
              rewrittenBullet,
            }],
          }),
        }],
      },
    }],
  }))
}

async function accessToken(
  role: 'CANDIDATE' | 'ADMIN' = 'CANDIDATE',
  userId = candidateId.toString(),
): Promise<string> {
  return new SignJWT({ role, tokenUse: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(accessSecret)
}

function nextAddress(): string {
  requestNumber += 1
  return `10.0.0.${requestNumber}`
}

function upload(
  token: string,
  buffer: Buffer,
  mimeType = pdfMimeType,
  filename = mimeType === pdfMimeType ? 'resume.pdf' : 'resume.docx',
) {
  return request(app)
    .post('/api/v1/resumes/parse-file')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Forwarded-For', nextAddress())
    .attach('file', buffer, { filename, contentType: mimeType })
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = accessSecretValue
  app.set('trust proxy', 1)
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
  await ResumeModel.init()
  await ResumeTemplateModel.init()
  await SkillTaxonomyModel.init()
})

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-api-key'
  process.env.GEMINI_MODEL = 'gemini-test-model'
  process.env.GROQ_API_KEY = 'test-groq-api-key'
  process.env.GROQ_MODEL = 'openai/gpt-oss-20b'
  extractResumeTextMock.mockReset()
  extractResumeTextMock.mockResolvedValue('Ada Lovelace\nJavaScript')
  structureResumeTextMock.mockReset()
  structureResumeTextMock.mockResolvedValue({
    personalInfo: {
      fullName: 'Ada Lovelace',
      email: null,
      phone: null,
      location: null,
      linkedinUrl: null,
      githubUrl: null,
    },
    workExperience: [],
    education: [],
    skills: ['JavaScript'],
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  clearSkillTaxonomyCache()
  if (initialGeminiApiKey === undefined) {
    delete process.env.GEMINI_API_KEY
  } else {
    process.env.GEMINI_API_KEY = initialGeminiApiKey
  }
  if (initialGeminiModel === undefined) {
    delete process.env.GEMINI_MODEL
  } else {
    process.env.GEMINI_MODEL = initialGeminiModel
  }
  if (initialGroqApiKey === undefined) {
    delete process.env.GROQ_API_KEY
  } else {
    process.env.GROQ_API_KEY = initialGroqApiKey
  }
  if (initialGroqModel === undefined) {
    delete process.env.GROQ_MODEL
  } else {
    process.env.GROQ_MODEL = initialGroqModel
  }
  await ResumeModel.deleteMany({})
  await ResumeTemplateModel.deleteMany({})
  await SkillTaxonomyModel.deleteMany({})
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

describe('POST /api/v1/resumes/parse-file', () => {
  it('requires an authenticated candidate', async () => {
    await request(app)
      .post('/api/v1/resumes/parse-file')
      .set('X-Forwarded-For', nextAddress())
      .expect(401, { error: 'Authentication required' })

    await upload(await accessToken('ADMIN'), Buffer.from('%PDF-1.4'))
      .expect(403, { error: 'Insufficient permissions' })

    await request(app)
      .get('/api/v1/resumes')
      .set('X-Forwarded-For', nextAddress())
      .expect(401, { error: 'Authentication required' })

    await request(app)
      .get('/api/v1/resumes')
      .set('Authorization', `Bearer ${await accessToken('ADMIN')}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(403, { error: 'Insufficient permissions' })
  })

  it('parses a supported PDF in memory and returns a draft', async () => {
    const pdf = Buffer.from('%PDF-1.4 document bytes')
    const response = await upload(await accessToken(), pdf).expect(201)
    expect(response.status).toBe(201)
    expect(response.body.resume).toMatchObject({
      title: "Ada Lovelace's Resume",
      entryMethod: 'PARSED_UPLOAD',
      personalInfo: { fullName: 'Ada Lovelace' },
      skills: ['JavaScript'],
      rawExtractedText: 'Ada Lovelace\nJavaScript',
    })
    expect(response.body.resume.id).toEqual(expect.any(String))
    expect(response.body.resume.createdAt).toEqual(expect.any(String))
    expect(extractResumeTextMock).toHaveBeenCalledOnce()
    expect(extractResumeTextMock).toHaveBeenCalledWith(pdf, pdfMimeType)
    expect(structureResumeTextMock).toHaveBeenCalledOnce()
    const stored = await ResumeModel.findById(response.body.resume.id).lean()
    expect(stored?.userId.toString()).toBe(candidateId.toString())
    expect(stored?.fileHash).toEqual(expect.any(String))
    expect(stored?.contentHash).toEqual(expect.any(String))
  })

  it('accepts DOCX uploads with the Office Open XML signature', async () => {
    const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])
    await upload(await accessToken(), docx, docxMimeType).expect(201)
    expect(extractResumeTextMock).toHaveBeenCalledWith(docx, docxMimeType)
  })

  it('rejects unsupported MIME types and files whose bytes do not match the MIME type', async () => {
    const token = await accessToken()
    await upload(token, Buffer.from('not a resume'), 'text/plain')
      .expect(415, { error: 'Only PDF and DOCX resumes are supported' })
    await upload(token, Buffer.from('not a PDF'))
      .expect(415, { error: 'The uploaded file does not match its declared type' })
    expect(extractResumeTextMock).not.toHaveBeenCalled()
  })

  it('enforces the 5 MB upload limit', async () => {
    await upload(await accessToken(), Buffer.alloc(5 * 1024 * 1024 + 1))
      .expect(413, { error: 'Resume file must be 5 MB or smaller' })
    expect(extractResumeTextMock).not.toHaveBeenCalled()
  })

  it('rejects a repeated file even when its filename changes', async () => {
    const token = await accessToken()
    const pdf = Buffer.from('%PDF-1.4 same resume')
    await upload(token, pdf, pdfMimeType, 'first-name.pdf').expect(201)
    await upload(token, pdf, pdfMimeType, 'renamed-resume.pdf')
      .expect(409, { error: 'This resume has already been uploaded and processed' })

    expect(extractResumeTextMock).toHaveBeenCalledOnce()
    expect(structureResumeTextMock).toHaveBeenCalledOnce()
    expect(await ResumeModel.countDocuments({ userId: candidateId })).toBe(1)
  })

  it('rejects equivalent extracted resume text from a differently encoded file', async () => {
    extractResumeTextMock
      .mockResolvedValueOnce('Ada Lovelace\nJavaScript')
      .mockResolvedValueOnce('  ADA   LOVELACE JavaScript  ')
    const token = await accessToken()
    await upload(token, Buffer.from('%PDF-1.4 original')).expect(201)
    await upload(token, Buffer.from('%PDF-1.4 regenerated'), pdfMimeType, 'different-name.pdf')
      .expect(409, { error: 'This resume has already been uploaded and processed' })

    expect(extractResumeTextMock).toHaveBeenCalledTimes(2)
    expect(structureResumeTextMock).toHaveBeenCalledOnce()
    expect(await ResumeModel.countDocuments({ userId: candidateId })).toBe(1)
  })

  it('uses the unique database index to reject simultaneous duplicate uploads', async () => {
    let releaseParsing: () => void = () => {}
    const parsingBarrier = new Promise<void>((resolve) => {
      releaseParsing = resolve
    })
    structureResumeTextMock.mockImplementation(async () => {
      await parsingBarrier
      return {
        personalInfo: {
          fullName: 'Ada Lovelace',
          email: null,
          phone: null,
          location: null,
          linkedinUrl: null,
          githubUrl: null,
        },
        workExperience: [],
        education: [],
        skills: [],
      }
    })

    const token = await accessToken()
    const first = upload(token, Buffer.from('%PDF-1.4 concurrent first')).then((result) => result)
    const second = upload(token, Buffer.from('%PDF-1.4 concurrent second')).then((result) => result)
    await vi.waitFor(() => expect(structureResumeTextMock).toHaveBeenCalledTimes(2))
    releaseParsing()

    const results = await Promise.all([first, second])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
    expect(await ResumeModel.countDocuments({ userId: candidateId })).toBe(1)
  })

  it('allows different resume content and keeps saved resumes private to their owner', async () => {
    extractResumeTextMock
      .mockResolvedValueOnce('Ada Lovelace')
      .mockResolvedValueOnce('Grace Hopper')
    const token = await accessToken()
    await upload(token, Buffer.from('%PDF-1.4 ada')).expect(201)
    await upload(token, Buffer.from('%PDF-1.4 grace')).expect(201)

    const listResponse = await request(app)
      .get('/api/v1/resumes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200)
    expect(listResponse.body.resumes).toHaveLength(2)
    expect(listResponse.body.resumes.map((resume: { rawExtractedText: string }) => resume.rawExtractedText))
      .toEqual(['Grace Hopper', 'Ada Lovelace'])
    expect(listResponse.body.resumes[0]).not.toHaveProperty('fileHash')
    expect(listResponse.body.resumes[0]).not.toHaveProperty('contentHash')
    expect(listResponse.body.resumes[0]).not.toHaveProperty('userId')

    const anotherUserToken = await accessToken('CANDIDATE', new mongoose.Types.ObjectId().toString())
    await upload(anotherUserToken, Buffer.from('%PDF-1.4 ada')).expect(201)
    const otherUserResponse = await request(app)
      .get('/api/v1/resumes')
      .set('Authorization', `Bearer ${anotherUserToken}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200)
    expect(otherUserResponse.body.resumes).toHaveLength(1)
    expect(otherUserResponse.body.resumes[0].rawExtractedText).toBe('Ada Lovelace\nJavaScript')
  })
})

describe('POST /api/v1/match/analyze', () => {
  async function createResume(
    userId = candidateId,
    overrides: Record<string, unknown> = {},
  ) {
    return ResumeModel.create({
      userId,
      title: 'Match test resume',
      entryMethod: 'FORM',
      fileHash: new mongoose.Types.ObjectId().toString(),
      contentHash: new mongoose.Types.ObjectId().toString(),
      personalInfo: {
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: null,
        location: null,
        linkedinUrl: null,
        githubUrl: null,
      },
      workExperience: [{
        company: 'Analytical Engines',
        position: 'Software Engineer',
        title: 'Frontend Engineer',
        startDate: '2021',
        endDate: null,
        isCurrent: true,
        bullets: ['Built React applications using TypeScript'],
      }],
      education: [],
      skills: ['React', 'TypeScript', 'Node.js', 'REST APIs'],
      ...overrides,
    })
  }

  it('requires an authenticated candidate and validates the request', async () => {
    const resume = await createResume()
    const body = {
      resumeId: resume.id,
      jobDescriptionText: 'React and TypeScript engineer',
    }

    await request(app)
      .post('/api/v1/match/analyze')
      .set('X-Forwarded-For', nextAddress())
      .send(body)
      .expect(401, { error: 'Authentication required' })

    await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken('ADMIN')}`)
      .set('X-Forwarded-For', nextAddress())
      .send(body)
      .expect(403, { error: 'Insufficient permissions' })

    const invalidResponse = await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({ ...body, resumeId: 'invalid' })
      .expect(400)
    expect(invalidResponse.body.error).toBe('Match analysis details are invalid')
    expect(invalidResponse.body.details).toEqual(expect.any(Array))
  })

  it('skips Gemini for matches below 20 percent', async () => {
    const resume = await createResume()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(groqCompletion({
      requirements: [{
        text: 'Nursing experience',
        normalizedTerm: 'Nursing',
        category: 'hard_skill',
        importance: 'required',
        confidence: 0.99,
        status: 'missing',
        evidence: [],
        minimumYears: null,
      }],
      taxonomyTerms: [],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({
        resumeId: resume.id,
        jobDescriptionText: 'Registered nurse providing patient care in a hospital',
      })
      .expect(200)

    expect(response.body).toMatchObject({
      matchScore: 0,
      proposedMatchScore: 0,
      scoreConfidence: 99,
      scoreMethod: 'weighted_requirement_coverage',
      analysisStatus: 'skipped',
      requirements: [{
        normalizedTerm: 'Nursing',
        status: 'missing',
      }],
      taxonomyUpdates: { addedSkills: 0, addedAliases: 0 },
      matchedHardSkills: [],
      missingCriticalKeywords: ['Nursing'],
      bulletPointRewrites: [],
    })
    expect(response.body.matchScore).toBeLessThan(20)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.groq.com/openai/v1/chat/completions')
    const groqBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string
      response_format: { json_schema: { strict: boolean } }
    }
    expect(groqBody.model).toBe('openai/gpt-oss-20b')
    expect(groqBody.response_format.json_schema.strict).toBe(true)
  })

  it('uses Gemini for relevant matches and sends structured, minimized context', async () => {
    const resume = await createResume()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(groqCompletion({
        requirements: [{
          text: 'React and TypeScript development',
          normalizedTerm: 'React and TypeScript',
          category: 'hard_skill',
          importance: 'required',
          confidence: 0.99,
          status: 'partial',
          evidence: ['Built React applications using TypeScript'],
          minimumYears: null,
        }],
        taxonomyTerms: [],
      }))
      .mockResolvedValueOnce(geminiCompletion('Developed React applications using TypeScript'))
      .mockResolvedValueOnce(groqCompletion({
        requirements: [{
          text: 'React and TypeScript development',
          normalizedTerm: 'React and TypeScript',
          category: 'hard_skill',
          importance: 'required',
          confidence: 0.99,
          status: 'matched',
          evidence: ['Developed React applications using TypeScript'],
          minimumYears: null,
        }],
        taxonomyTerms: [],
      }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.GEMINI_API_KEY = 'test-api-key'
    process.env.GEMINI_MODEL = 'gemini-test-model'

    const response = await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({
        resumeId: resume.id,
        jobDescriptionText: 'Build React and TypeScript applications with Node.js and REST APIs',
      })
      .expect(200)

    expect(response.body).toMatchObject({
      matchScore: expect.any(Number),
      proposedMatchScore: expect.any(Number),
      scoreConfidence: 99,
      scoreMethod: 'weighted_requirement_coverage',
      analysisStatus: 'completed',
      requirements: [{
        text: 'React and TypeScript development',
        status: 'partial',
        evidence: ['Built React applications using TypeScript'],
      }],
      taxonomyUpdates: { addedSkills: 0, addedAliases: 0 },
      matchedHardSkills: ['React', 'TypeScript'],
      missingCriticalKeywords: ['Accessibility'],
      bulletPointRewrites: [{
        originalBullet: 'Built React applications using TypeScript',
        rewrittenBullet: 'Developed React applications using TypeScript',
      }],
    })
    expect(response.body.matchScore).toBe(50)
    expect(response.body.proposedMatchScore).toBe(100)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const groqRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>
      response_format: { type: string }
    }
    expect(groqRequestBody.response_format.type).toBe('json_schema')
    expect(groqRequestBody.messages[1]?.content).toContain('React')
    const proposedGroqBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      messages: Array<{ content: string }>
    }
    expect(proposedGroqBody.messages[1]?.content).toContain('Developed React applications using TypeScript')

    expect(fetchMock.mock.calls[1]?.[0]).toContain('generativelanguage.googleapis.com')
    const geminiRequestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      contents: Array<{ parts: Array<{ text: string }> }>
    }
    const prompt = geminiRequestBody.contents[0]?.parts[0]?.text
    expect(prompt).toContain('React and TypeScript development')
    expect(prompt).toContain('Built React applications using TypeScript')
    expect(prompt).not.toContain('ada@example.com')
    expect(prompt).not.toContain('jobDescription')
  })

  it('automatically adds high-confidence aliases and previously unseen technical skills', async () => {
    const resume = await createResume()
    await SkillTaxonomyModel.create({
      canonicalId: 'react',
      canonicalName: 'React',
      aliases: [],
      category: 'hard_skill',
      source: 'test',
    })
    clearSkillTaxonomyCache()

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(groqCompletion({
        requirements: [{
          text: 'React development',
          normalizedTerm: 'React',
          category: 'hard_skill',
          importance: 'required',
          confidence: 0.99,
          status: 'matched',
          evidence: ['Built React applications using TypeScript'],
          minimumYears: null,
        }],
        taxonomyTerms: [
          {
            canonicalId: 'react',
            canonicalName: 'React',
            category: 'hard_skill',
            observedTerms: ['React', 'React.js'],
            confidence: 0.99,
          },
          {
            canonicalId: null,
            canonicalName: 'Rust',
            category: 'hard_skill',
            observedTerms: ['Rust'],
            confidence: 0.99,
          },
        ],
      }))
      .mockResolvedValueOnce(geminiCompletion())
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({
        resumeId: resume.id,
        jobDescriptionText: 'React.js and Rust experience preferred',
      })
      .expect(200)

    expect(response.body.taxonomyUpdates).toEqual({ addedSkills: 1, addedAliases: 1 })
    expect(await SkillTaxonomyModel.findOne({ canonicalId: 'react' }).lean())
      .toMatchObject({ aliases: ['React.js'] })
    expect(await SkillTaxonomyModel.findOne({ canonicalName: 'Rust' }).lean())
      .toMatchObject({ category: 'hard_skill', source: 'Groq-discovered' })
  })

  it('ignores mismatched taxonomy references without failing the match analysis', async () => {
    const resume = await createResume()
    await SkillTaxonomyModel.create({
      canonicalId: 'react',
      canonicalName: 'React',
      aliases: [],
      category: 'hard_skill',
      source: 'test',
    })
    clearSkillTaxonomyCache()

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(groqCompletion({
        requirements: [{
          text: 'React development',
          normalizedTerm: 'React',
          category: 'hard_skill',
          importance: 'required',
          confidence: 0.99,
          status: 'matched',
          evidence: ['Built React applications using TypeScript'],
          minimumYears: null,
        }],
        taxonomyTerms: [{
          canonicalId: 'react',
          canonicalName: 'TypeScript',
          category: 'hard_skill',
          observedTerms: ['React.js'],
          confidence: 0.99,
        }],
      }))
      .mockResolvedValueOnce(geminiCompletion())
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({
        resumeId: resume.id,
        jobDescriptionText: 'React.js development',
      })
      .expect(200)

    expect(response.body.analysisStatus).toBe('completed')
    expect(response.body.taxonomyUpdates).toEqual({ addedSkills: 0, addedAliases: 0 })
    expect(await SkillTaxonomyModel.findOne({ canonicalId: 'react' }).lean())
      .toMatchObject({ aliases: [] })
  })

  it('does not trust evidence that Groq claims but is absent from the resume', async () => {
    const resume = await createResume()
    process.env.GEMINI_API_KEY = 'test-api-key'
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(groqCompletion({
        requirements: [{
          text: 'Kubernetes experience',
          normalizedTerm: 'Kubernetes',
          category: 'tool',
          importance: 'required',
          confidence: 0.99,
          status: 'matched',
          evidence: ['Managed Kubernetes clusters'],
          minimumYears: null,
        }],
        taxonomyTerms: [],
      }))
      .mockResolvedValueOnce(geminiCompletion())
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({ resumeId: resume.id, jobDescriptionText: 'Kubernetes specialist' })
      .expect(200)

    expect(response.body.requirements[0]).toMatchObject({
      status: 'unclear',
      confidence: 0.5,
      evidence: [],
    })
    expect(response.body.analysisStatus).toBe('completed')
  })

  it('downgrades matched requirements when Groq returns no resume evidence', async () => {
    const resume = await createResume()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(groqCompletion({
        requirements: [{
          text: 'Kubernetes experience',
          normalizedTerm: 'Kubernetes',
          category: 'tool',
          importance: 'required',
          confidence: 0.99,
          status: 'matched',
          evidence: [],
          minimumYears: null,
        }],
        taxonomyTerms: [],
      }))
      .mockResolvedValueOnce(geminiCompletion())
    vi.stubGlobal('fetch', fetchMock)

    const response = await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({ resumeId: resume.id, jobDescriptionText: 'Kubernetes specialist' })
      .expect(200)

    expect(response.body.requirements[0]).toMatchObject({
      status: 'unclear',
      confidence: 0.5,
      evidence: [],
    })
    expect(response.body.analysisStatus).toBe('completed')
  })

  it('uses weighted requirement coverage and avoids confidently skipping uncertain matches', () => {
    const baseRequirement = {
      text: 'Python experience',
      normalizedTerm: 'Python',
      category: 'hard_skill' as const,
      importance: 'required' as const,
      confidence: 0.99,
      status: 'missing' as const,
      evidence: [],
      minimumYears: null,
    }
    expect(calculateWeightedMatchScore([baseRequirement])).toMatchObject({
      matchScore: 0,
      scoreConfidence: 99,
      shouldSkipGemini: true,
    })
    expect(calculateWeightedMatchScore([
      { ...baseRequirement, confidence: 0.6 },
    ]).shouldSkipGemini).toBe(false)
    expect(calculateWeightedMatchScore([
      { ...baseRequirement, status: 'partial' },
      { ...baseRequirement, status: 'matched', importance: 'preferred' },
    ]).matchScore).toBe(67)
  })

  it('does not expose another candidate’s resume', async () => {
    const resume = await createResume(new mongoose.Types.ObjectId())
    await request(app)
      .post('/api/v1/match/analyze')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({
        resumeId: resume.id,
        jobDescriptionText: 'React and TypeScript engineer',
      })
      .expect(404, { error: 'Resume not found' })
  })

})

describe('resume builder endpoints', () => {
  const resumeInput = {
    title: 'Ada Lovelace Resume',
    personalInfo: {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: null,
      location: 'London',
      linkedinUrl: null,
      githubUrl: null,
    },
    workExperience: [{
      company: 'Analytical Engines',
      position: 'Project lead',
      title: 'Engineer',
      startDate: '1842',
      endDate: null,
      isCurrent: true,
      bullets: ['Built reliable systems'],
    }],
    education: [{
      institution: 'University of London',
      award: 'Diploma',
      fieldOfStudy: null,
      graduationYear: 2018,
    }],
    skills: ['Analysis', 'Programming'],
  }

  it('creates, reads, updates, and exports an ATS-friendly PDF', async () => {
    const token = await accessToken()
    const createdResponse = await request(app)
      .post('/api/v1/resumes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .send(resumeInput)
      .expect(201)
    const created = createdResponse.body.resume

    expect(created).toMatchObject({
      title: 'Ada Lovelace Resume',
      entryMethod: 'FORM',
      personalInfo: { fullName: 'Ada Lovelace' },
      workExperience: resumeInput.workExperience,
      education: resumeInput.education,
      skills: resumeInput.skills,
      template: { name: 'Classic', layout: 'single-column' },
      rawExtractedText: '',
    })
    expect(created.id).toEqual(expect.any(String))
    expect(created.updatedAt).toEqual(expect.any(String))

    const readResponse = await request(app)
      .get(`/api/v1/resumes/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200)
    expect(readResponse.body.resume.id).toBe(created.id)

    const customTemplate = {
      name: 'Product Designer',
      fontFamily: 'Times-Roman',
      fontSize: 11,
      accentColor: '#2457a7',
      textColor: '#18243a',
      backgroundColor: '#ffffff',
      layout: 'two-column',
    }
    const updateResponse = await request(app)
      .put(`/api/v1/resumes/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .send({ ...resumeInput, title: 'Updated Resume', skills: ['Analysis'], template: customTemplate })
      .expect(200)
    expect(updateResponse.body.resume.title).toBe('Updated Resume')
    expect(updateResponse.body.resume.skills).toEqual(['Analysis'])
    expect(updateResponse.body.resume.template).toEqual(customTemplate)
    expect(await ResumeModel.countDocuments({ userId: candidateId })).toBe(1)

    const pdfResponse = await request(app)
      .get(`/api/v1/resumes/${created.id}/export-pdf`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200)
    expect(pdfResponse.headers['content-type']).toMatch(/application\/pdf/)
    expect(pdfResponse.headers['content-disposition']).toMatch(/ada-lovelace\.pdf/)
    expect(Buffer.isBuffer(pdfResponse.body)).toBe(true)
    expect(pdfResponse.body.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('validates resume input and prevents access to another candidate’s resume', async () => {
    const token = await accessToken()
    const invalidResponse = await request(app)
      .post('/api/v1/resumes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .send({ ...resumeInput, personalInfo: { ...resumeInput.personalInfo, email: 'invalid' } })
      .expect(400)
    expect(invalidResponse.body.error).toBe('Resume details are invalid')
    expect(invalidResponse.body.details).toEqual(expect.any(Array))

    const created = await request(app)
      .post('/api/v1/resumes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .send(resumeInput)
      .expect(201)
    const otherUserToken = await accessToken('CANDIDATE', new mongoose.Types.ObjectId().toString())
    await request(app)
      .get(`/api/v1/resumes/${created.body.resume.id}`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(404, { error: 'Resume not found' })
    await request(app)
      .put(`/api/v1/resumes/${created.body.resume.id}`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .set('X-Forwarded-For', nextAddress())
      .send(resumeInput)
      .expect(404, { error: 'Resume not found' })
  })
})

describe('resume template endpoints', () => {
  const templateInput = {
    name: 'Product Designer',
    fontFamily: 'Times-Roman',
    fontSize: 11,
    accentColor: '#2457a7',
    textColor: '#18243a',
    backgroundColor: '#ffffff',
    layout: 'two-column',
  }

  it('creates, lists, updates, and deletes candidate-owned templates', async () => {
    const token = await accessToken()
    const createdResponse = await request(app)
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .send(templateInput)
      .expect(201)
    const created = createdResponse.body.template
    expect(created).toMatchObject(templateInput)
    expect(created.id).toEqual(expect.any(String))

    const listResponse = await request(app)
      .get('/api/v1/templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200)
    expect(listResponse.body.templates).toHaveLength(1)
    expect(listResponse.body.templates[0].id).toBe(created.id)

    const updatedInput = { ...templateInput, name: 'Editorial', layout: 'single-column' }
    const updatedResponse = await request(app)
      .put(`/api/v1/templates/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .send(updatedInput)
      .expect(200)
    expect(updatedResponse.body.template).toMatchObject(updatedInput)

    const otherUserToken = await accessToken('CANDIDATE', new mongoose.Types.ObjectId().toString())
    await request(app)
      .delete(`/api/v1/templates/${created.id}`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(404, { error: 'Template not found' })
    await request(app)
      .delete(`/api/v1/templates/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(204)
    expect(await ResumeTemplateModel.countDocuments({ userId: candidateId })).toBe(0)
  })

  it('rejects invalid design settings and requires a candidate session', async () => {
    const invalid = await request(app)
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('X-Forwarded-For', nextAddress())
      .send({ ...templateInput, accentColor: 'blue' })
      .expect(400)
    expect(invalid.body.error).toBe('Template details are invalid')

    await request(app)
      .get('/api/v1/templates')
      .set('X-Forwarded-For', nextAddress())
      .expect(401, { error: 'Authentication required' })
    await request(app)
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${await accessToken('ADMIN')}`)
      .set('X-Forwarded-For', nextAddress())
      .send(templateInput)
      .expect(403, { error: 'Insufficient permissions' })
  })
})
