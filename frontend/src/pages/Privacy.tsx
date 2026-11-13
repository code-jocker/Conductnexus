import { Link } from 'react-router-dom'
import { ArrowLeft, Database, FileCheck2, GraduationCap, Lock, Mail, Scale, ShieldCheck, Users } from 'lucide-react'
import { Card } from '../components/ui'
import { Footer } from '../components/Footer'
import { ImigongoBand } from '../components/Imigongo'

const SECTIONS = [
  {
    id: 'controller',
    icon: GraduationCap,
    title: 'Who is responsible for your data',
    body: [
      'ConductNexus is the conduct and discipline management platform operated by the school that holds your account. The school is the data controller: it decides why learner conduct, attendance, welfare and guardian contact information is recorded.',
      'The platform provider processes that information only on the school’s documented instructions, and keeps an audit trail of every administrative action.',
    ],
  },
  {
    id: 'collected',
    icon: Database,
    title: 'Information we hold',
    body: [
      'Learner records: names, admission numbers, class, stream, dormitory, guardians, conduct ledger entries, incidents, investigations, appeals, recognition and support interventions.',
      'Guardian and staff records: names, telephone numbers, email addresses, relationship to the learner, communication preferences and consent decisions.',
      'Safeguarding information is restricted to authorised staff and is never shown to other learners or to general users of the platform.',
      'Technical records: sign-in history, device session data, audit logs, error diagnostics and delivery receipts for messages sent to guardians.',
    ],
  },
  {
    id: 'basis',
    icon: Scale,
    title: 'Lawful basis',
    body: [
      'We process learner data to perform the school’s educational duties and to safeguard children, as permitted by Rwandan law — in particular Law No. 058/2021 of 13/10/2021 on the protection of personal data and privacy.',
      'Guardian contact preferences, WhatsApp, SMS and email consent, and optional portal features rely on consent. Consent can be withdrawn at any time without affecting the lawfulness of earlier processing.',
      'Records may also be processed to comply with legal obligations, to defend legal claims, or for the school’s legitimate interest in maintaining a safe and orderly learning environment.',
    ],
  },
  {
    id: 'use',
    icon: FileCheck2,
    title: 'How the information is used',
    body: [
      'Recording disciplinary incidents, applying the published conduct scale, calculating starting marks each term and tracking a learner’s conduct balance.',
      'Reviewing and approving decisions independently, managing investigations, appeals, hearings and parent meetings.',
      'Notifying guardians through the channels they have consented to, within configured quiet hours, with retries recorded for every message.',
      'Producing term, year-end, class, teacher-activity and communication reports for the school leadership, and maintaining the audit trail required for accountability.',
    ],
  },
  {
    id: 'retention',
    icon: Lock,
    title: 'Retention and security',
    body: [
      'The school configures retention periods for learner records, discipline records, evidence files, audit logs and safeguarding records. Records that reach the end of their retention period are removed or anonymised.',
      'Access is limited by role and by granular permissions. Passwords are stored as one-way hashes, sessions can be revoked remotely, and sensitive actions are written to an immutable audit log.',
      'Backups are encrypted in transit, tested for restoration, and kept only for the configured retention window. Error diagnostics never include passwords or authentication tokens.',
    ],
  },
  {
    id: 'sharing',
    icon: Users,
    title: 'Sharing and transfers',
    body: [
      'Information is shared with the school’s authorised staff, with a learner’s guardians through the parent portal, and with service providers who deliver email, SMS or WhatsApp messages on the school’s behalf.',
      'We do not sell personal data, and we do not use learner information for advertising.',
      'Where a service provider processes data outside Rwanda, the school relies on appropriate safeguards and keeps a record of the transfer, as required by the data protection authority.',
    ],
  },
  {
    id: 'rights',
    icon: ShieldCheck,
    title: 'Your rights',
    body: [
      'You may ask to see the personal data held about you or your child, request correction of inaccurate records, object to certain processing, withdraw consent, or request deletion where retention no longer applies.',
      'Requests can be submitted from the parent portal under “Data requests”, or in writing to the school’s data protection contact. The school logs every request and responds within the period set by Rwandan law.',
      'If a request is refused, you will receive the reason in writing and information about how to complain to the National Cyber Security Authority.',
    ],
  },
  {
    id: 'breach',
    icon: Mail,
    title: 'Reporting a concern',
    body: [
      'Suspected data breaches, lost devices or accidental disclosures should be reported to the school immediately so that containment, assessment and notification can begin.',
      'Where a breach is likely to result in a high risk to individuals, the school notifies the supervisory authority and the affected people without undue delay, and records the incident in the breach register.',
      'Questions about this notice, or about how the school handles personal data, can be addressed to the school office or the designated data protection officer.',
    ],
  },
]

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas dark:bg-[#0a1424]">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-cyan-accent">
              <GraduationCap className="h-5 w-5" />
            </span>
            <span className="font-display text-base font-semibold">
              Conduct<span className="text-ochre-400">Nexus</span>
            </span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to the platform
          </Link>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-6 sm:px-6 sm:pb-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ochre-300">Rwanda Law No. 058/2021</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">Data protection and privacy notice</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
            How ConductNexus and your school collect, use, protect and retain information about learners, guardians and staff —
            and how you can exercise your rights.
          </p>
          <p className="mt-4 text-xs text-slate-400">Last updated 13 November 2026</p>
        </div>
        <ImigongoBand />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-6 space-y-1">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">On this page</p>
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block rounded-md px-2 py-1.5 text-xs text-slate-600 transition hover:bg-white hover:text-brand-700 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-brand-200"
                >
                  {section.title}
                </a>
              ))}
            </div>
          </nav>

          <div className="space-y-4">
            {SECTIONS.map((section) => (
              <Card key={section.id} className="scroll-mt-6 p-5 sm:p-6" >
                <div id={section.id} className="scroll-mt-24">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200">
                      <section.icon className="h-4.5 w-4.5" />
                    </span>
                    <h2 className="mt-1.5 text-base font-semibold text-slate-900 dark:text-white">{section.title}</h2>
                  </div>
                  <div className="mt-3 space-y-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              </Card>
            ))}

            <Card className="border-ochre-300/60 bg-ochre-500/5 p-5 dark:border-ochre-900 dark:bg-ochre-950/20 sm:p-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Contact the school</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Requests about personal data should go to your school’s data protection contact. Staff with the
                <span className="font-semibold"> data protection </span> permission can log and track every request inside
                the platform, including breach notifications and disclosure records.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/portal" className="btn-secondary inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold">
                  Parent portal · data requests
                </Link>
                <a href="mailto:dpo@school.rw" className="btn-secondary inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold">
                  <Mail className="h-3.5 w-3.5" /> dpo@school.rw
                </a>
              </div>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
