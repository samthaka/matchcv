export type ResumeTemplate = {
  id: string
  name: string
  fontFamily: 'Helvetica' | 'Times-Roman' | 'Courier'
  fontSize: number
  accentColor: string
  textColor: string
  backgroundColor: string
  layout: 'single-column' | 'two-column'
  isBuiltIn?: boolean
}

export const DEFAULT_TEMPLATE: ResumeTemplate = {
  id: 'classic',
  name: 'Classic',
  fontFamily: 'Helvetica',
  fontSize: 10,
  accentColor: '#365fce',
  textColor: '#17213a',
  backgroundColor: '#ffffff',
  layout: 'single-column',
  isBuiltIn: true,
}

export const BUILT_IN_TEMPLATES: ResumeTemplate[] = [
  DEFAULT_TEMPLATE,
  {
    id: 'modern',
    name: 'Modern',
    fontFamily: 'Helvetica',
    fontSize: 10,
    accentColor: '#0f766e',
    textColor: '#173330',
    backgroundColor: '#ffffff',
    layout: 'two-column',
    isBuiltIn: true,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    fontFamily: 'Times-Roman',
    fontSize: 11,
    accentColor: '#755c3b',
    textColor: '#29251f',
    backgroundColor: '#ffffff',
    layout: 'single-column',
    isBuiltIn: true,
  },
  {
    id: 'compact',
    name: 'Compact',
    fontFamily: 'Courier',
    fontSize: 9,
    accentColor: '#7252a3',
    textColor: '#292333',
    backgroundColor: '#fbfaff',
    layout: 'two-column',
    isBuiltIn: true,
  },
]

export function templateDesign(
  template: Pick<
    ResumeTemplate,
    'name' | 'fontFamily' | 'fontSize' | 'accentColor' | 'textColor' | 'backgroundColor' | 'layout'
  >,
) {
  return {
    name: template.name,
    fontFamily: template.fontFamily,
    fontSize: template.fontSize,
    accentColor: template.accentColor,
    textColor: template.textColor,
    backgroundColor: template.backgroundColor,
    layout: template.layout,
  }
}
