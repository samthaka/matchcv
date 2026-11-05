export type ResumeInput = {
  title: string
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
    fieldOfStudy: string | null
    graduationYear: number | null
  }>
  skills: string[]
}

export type ResumeRecord = ResumeInput & {
  id: string
  createdAt: string
  updatedAt: string
  entryMethod: 'FORM' | 'PARSED_UPLOAD'
  rawExtractedText: string
}
