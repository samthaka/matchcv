import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../src/utils/http-error.js'
import { extractResumeText, parseResume, structureResumeText } from '../src/services/resume-parser.js'

const fetchMock = vi.fn<typeof fetch>()

const structuredResume = {
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
    position: 'Engineer',
    startDate: '1842',
    endDate: null,
    isCurrent: false,
    bullets: ['Designed an algorithm'],
  }],
  education: [],
  skills: ['Mathematics'],
}

function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf)
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-api-key'
  process.env.GEMINI_MODEL = 'gemini-test-model'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
})

describe('resume parser service', () => {
  it('extracts PDF text and returns a validated structured draft', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(structuredResume) }] } }],
    })))

    const result = await parseResume(makePdf('Ada Lovelace'), 'application/pdf')

    expect(result.rawExtractedText).toContain('Ada Lovelace')
    expect(result.resume).toEqual(structuredResume)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'x-goog-api-key': 'test-api-key',
          'Content-Type': 'application/json',
        },
        signal: expect.any(AbortSignal),
        body: expect.stringContaining('"responseMimeType":"application/json"'),
      }),
    )
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      generationConfig: { responseSchema: { properties: Record<string, { type: string }> } }
    }
    expect(requestBody.generationConfig.responseSchema.properties.personalInfo?.type).toBe('OBJECT')
    expect(requestBody.generationConfig.responseSchema.properties.workExperience?.type).toBe('ARRAY')
  })

  it('does not send requests to Gemini without an API key', async () => {
    delete process.env.GEMINI_API_KEY

    await expect(structureResumeText('Resume text')).rejects.toMatchObject({
      statusCode: 503,
      message: 'Resume parsing is not configured',
    })
    await expect(parseResume(Buffer.from('not a PDF'), 'application/pdf')).rejects.toMatchObject({
      statusCode: 503,
      message: 'Resume parsing is not configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed provider output instead of returning an empty draft', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"skills": []}' }] } }],
    })))

    await expect(structureResumeText('Resume text')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Resume parsing provider returned an invalid resume draft',
    })
  })

  it('rejects unsupported file types before calling an extractor', async () => {
    await expect(extractResumeText(Buffer.from('resume'), 'text/plain'))
      .rejects.toBeInstanceOf(HttpError)
  })
})
