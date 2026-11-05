import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { ReactNode } from 'react'

type PdfResume = {
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

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingRight: 52,
    paddingBottom: 48,
    paddingLeft: 52,
    color: '#17213a',
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.4,
  },
  name: {
    marginBottom: 5,
    fontSize: 18,
    fontWeight: 700,
  },
  contact: {
    marginBottom: 14,
    color: '#38445a',
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    marginBottom: 5,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: '#56647b',
    fontSize: 11,
    fontWeight: 700,
  },
  item: {
    marginBottom: 7,
  },
  itemTitle: {
    fontWeight: 700,
  },
  meta: {
    color: '#38445a',
  },
  bullet: {
    marginLeft: 12,
  },
})

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

export async function renderResumePdf(resume: PdfResume): Promise<Buffer> {
  const personalDetails = [
    resume.personalInfo.email,
    resume.personalInfo.phone,
    resume.personalInfo.location,
    resume.personalInfo.linkedinUrl,
    resume.personalInfo.githubUrl,
  ].filter((value): value is string => Boolean(value?.trim()))

  return renderToBuffer(
    <Document
      title={resume.title}
      {...(resume.personalInfo.fullName ? { author: resume.personalInfo.fullName } : {})}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{resume.personalInfo.fullName || resume.title}</Text>
        {personalDetails.length > 0 && (
          <Text style={styles.contact}>{personalDetails.join(' | ')}</Text>
        )}

        {resume.workExperience.length > 0 && (
          <Section title="Work Experience">
            {resume.workExperience.map((experience, index) => (
              <View key={`experience-${index}`} style={styles.item}>
                <Text style={styles.itemTitle}>
                  {[experience.position, experience.title, experience.company].filter(Boolean).join(' · ') || 'Experience'}
                </Text>
                <Text style={styles.meta}>
                  {[experience.startDate, experience.isCurrent ? 'Present' : experience.endDate]
                    .filter(Boolean)
                    .join(' – ')}
                </Text>
                {experience.bullets.map((bullet, bulletIndex) => (
                  <Text key={`experience-${index}-bullet-${bulletIndex}`} style={styles.bullet}>
                    • {bullet}
                  </Text>
                ))}
              </View>
            ))}
          </Section>
        )}

        {resume.education.length > 0 && (
          <Section title="Education">
            {resume.education.map((education, index) => (
              <View key={`education-${index}`} style={styles.item}>
                <Text style={styles.itemTitle}>
                  {[education.award, education.fieldOfStudy].filter(Boolean).join(', ') || 'Education'}
                </Text>
                <Text style={styles.meta}>
                  {[education.institution, education.graduationYear].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))}
          </Section>
        )}

        {resume.skills.length > 0 && (
          <Section title="Skills">
            <Text>{resume.skills.join(' · ')}</Text>
          </Section>
        )}
      </Page>
    </Document>,
  )
}
