import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Language = 'en' | 'rw'

const DICTIONARY: Record<string, { en: string; rw: string }> = {
  'nav.dashboard': { en: 'Dashboard', rw: 'Imbonerahamwe' },
  'nav.students': { en: 'Students', rw: 'Abanyeshuri' },
  'nav.promotions': { en: 'Promotions', rw: 'Kuzamurwa mu byiciro' },
  'nav.attendance': { en: 'Attendance', rw: 'Kwitabira' },
  'nav.boarding': { en: 'Boarding', rw: 'Iburiro' },
  'nav.welfare': { en: 'Welfare centre', rw: 'Ikigo cy’ubuzima n’ubufasha' },
  'nav.incidents': { en: 'Incidents', rw: 'Ibikorwa bibi' },
  'nav.approvals': { en: 'Approvals', rw: 'Ibyemejwe' },
  'nav.discipline': { en: 'Conduct ledger', rw: 'Ibaruwa y’imyitwarire' },
  'nav.bulk': { en: 'Bulk conduct', rw: 'Imyitwarire rusange' },
  'nav.risk': { en: 'Risk & support', rw: 'Ingorane n’ubufasha' },
  'nav.safeguarding': { en: 'Safeguarding', rw: 'Kurinda abanyeshuri' },
  'nav.investigations': { en: 'Investigations', rw: 'Iperereza' },
  'nav.appeals': { en: 'Appeals', rw: 'Ibijurire' },
  'nav.evidence': { en: 'Evidence', rw: 'Ibimenyetso' },
  'nav.policies': { en: 'Rules & policies', rw: 'Amabwiriza na politiki' },
  'nav.meetings': { en: 'Meetings', rw: 'Inama' },
  'nav.communications': { en: 'Communication', rw: 'Itumanaho' },
  'nav.reports': { en: 'Reports', rw: 'Raporo' },
  'nav.structure': { en: 'School structure', rw: 'Imiterere y’ishuri' },
  'nav.users': { en: 'Users & roles', rw: 'Abakoresha n’inshingano' },
  'nav.settings': { en: 'Settings', rw: 'Igenamiterere' },
  'nav.audit': { en: 'Audit trail', rw: 'Urutonde rw’ibyakozwe' },
  'nav.monitoring': { en: 'Monitoring', rw: 'Igenzura' },
  'nav.data': { en: 'Data protection', rw: 'Kurinda amakuru' },
  'nav.portal': { en: 'My children', rw: 'Abana banjye' },
  'nav.drafts': { en: 'Offline drafts', rw: 'Ibyanditswe bitaratumwa' },
  'action.signIn': { en: 'Sign in', rw: 'Injira' },
  'action.signOut': { en: 'Sign out', rw: 'Sohoka' },
  'action.save': { en: 'Save', rw: 'Bika' },
  'action.cancel': { en: 'Cancel', rw: 'Hagarika' },
  'action.search': { en: 'Search', rw: 'Shakisha' },
  'action.new': { en: 'New', rw: 'Gishya' },
  'action.export': { en: 'Export', rw: 'Ohereza' },
  'common.loading': { en: 'Loading…', rw: 'Birategurwa…' },
  'common.noRecords': { en: 'No records found', rw: 'Nta makuru abonetse' },
  'common.notes': { en: 'Notes', rw: 'Inyandiko' },
  'common.status': { en: 'Status', rw: 'Imiterere' },
  'common.date': { en: 'Date', rw: 'Itariki' },
}

type I18nValue = {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => (localStorage.getItem('cn_language') as Language) || 'en')

  useEffect(() => {
    localStorage.setItem('cn_language', language)
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage: setLanguageState,
      t: (key) => DICTIONARY[key]?.[language] ?? DICTIONARY[key]?.en ?? key,
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
