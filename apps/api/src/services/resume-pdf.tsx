import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { ReactNode } from 'react'

type PdfTemplate = {
  name: string
  fontFamily: 'Helvetica' | 'Times-Roman' | 'Courier'
  fontSize: number
  accentColor: string
  textColor: string
  backgroundColor: string
  layout: 'single-column' | 'two-column'
}

type PdfResume = {
  title: string
  template?: PdfTemplate
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

function createStyles(template: PdfTemplate) {
  const sectionTitle = template.fontSize + 1
  return StyleSheet.create({
    page: {
      paddingTop: 48,
      paddingRight: 52,
      paddingBottom: 48,
      paddingLeft: 52,
      color: template.textColor,
      backgroundColor: template.backgroundColor,
      fontFamily: template.fontFamily,
      fontSize: template.fontSize,
      lineHeight: 1.4,
    },
    columns: {
      display: 'flex',
      flexDirection: 'row',
      gap: 20,
    },
    sidebar: {
      width: '30%',
      paddingRight: 12,
      borderRightWidth: 1,
      borderRightColor: template.accentColor,
    },
    main: {
      flex: 1,
    },
    name: {
      marginBottom: 5,
      color: template.accentColor,
      fontSize: template.fontSize + 8,
      fontWeight: 700,
    },
    contact: {
      marginBottom: 14,
      color: template.textColor,
      fontSize: Math.max(template.fontSize - 1, 7),
    },
    section: {
      marginTop: 10,
    },
    sectionTitle: {
      marginBottom: 5,
      paddingBottom: 3,
      borderBottomWidth: 0.75,
      borderBottomColor: template.accentColor,
      color: template.accentColor,
      fontSize: sectionTitle,
      fontWeight: 700,
    },
    item: {
      marginBottom: 7,
    },
    itemTitle: {
      fontWeight: 700,
    },
    meta: {
      color: template.textColor,
      opacity: 0.75,
    },
    bullet: {
      marginLeft: 12,
    },
  })
}

function Section({
  title,
  children,
  styles,
}: {
  title: string
  children: ReactNode
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

export async function renderResumePdf(resume: PdfResume): Promise<Buffer> {
  const template = resume.template ?? {
    name: 'Classic',
    fontFamily: 'Helvetica' as const,
    fontSize: 10,
    accentColor: '#365fce',
    textColor: '#17213a',
    backgroundColor: '#ffffff',
    layout: 'single-column' as const,
  }
  const styles = createStyles(template)
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
          <Text style={styles.contact}>
            {template.layout === 'single-column' ? personalDetails.join(' | ') : personalDetails.slice(0, 3).join('\n')}
          </Text>
        )}

        {template.layout === 'two-column' ? (
          <View style={styles.columns}>
            <View style={styles.sidebar}>
              {personalDetails.length > 3 && (
                <Text style={styles.contact}>{personalDetails.slice(3).join('\n')}</Text>
              )}
              {resume.education.length > 0 && (
                <Section styles={styles} title="Education">
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
                <Section styles={styles} title="Skills">
                  <Text>{resume.skills.join(' · ')}</Text>
                </Section>
              )}
            </View>
            <View style={styles.main}>
              {resume.workExperience.length > 0 && (
                <Section styles={styles} title="Work Experience">
                  {resume.workExperience.map((experience, index) => (
                    <ExperienceItem key={`experience-${index}`} experience={experience} index={index} styles={styles} />
                  ))}
                </Section>
              )}
            </View>
          </View>
        ) : (
          <>
            {resume.workExperience.length > 0 && (
              <Section styles={styles} title="Work Experience">
                {resume.workExperience.map((experience, index) => (
                  <ExperienceItem key={`experience-${index}`} experience={experience} index={index} styles={styles} />
                ))}
              </Section>
            )}
            {resume.education.length > 0 && (
              <Section styles={styles} title="Education">
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
              <Section styles={styles} title="Skills">
                <Text>{resume.skills.join(' · ')}</Text>
              </Section>
            )}
          </>
        )}
      </Page>
    </Document>,
  )
}

function ExperienceItem({
  experience,
  index,
  styles,
}: {
  experience: PdfResume['workExperience'][number]
  index: number
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View style={styles.item}>
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
  )
}
