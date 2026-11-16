import type { TemplateCategory } from '../models/communications.js'

/**
 * Canonical bilingual template library.
 *
 * This is the single source of truth for every ConductNexus communication
 * template. The seeder upserts from here without ever deleting an existing
 * record, and "restore default" copies the `en`/`rw` content below back over an
 * administrator's edits.
 *
 * Placeholders are derived from the template text itself so a template can never
 * advertise a placeholder it does not use, nor use one it does not advertise.
 */

export const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g

export function extractPlaceholders(...texts: string[]): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) found.add(match[1])
  }
  return [...found].sort()
}

export type BilingualContent = { subject: string; body: string }

export type BilingualNotificationTemplate = {
  key: string
  name: string
  nameRw: string
  description: string
  category: TemplateCategory
  channel: 'in_app' | 'whatsapp' | 'sms' | 'email'
  en: BilingualContent
  rw: BilingualContent
}

export type BilingualLetterTemplate = {
  type: string
  name: string
  nameRw: string
  description: string
  category: TemplateCategory
  en: BilingualContent
  rw: BilingualContent
}

// ── 1. Notification templates (21 types × EN/RW) ────────────────────────────

export const NOTIFICATION_TEMPLATE_LIBRARY: BilingualNotificationTemplate[] = [
  {
    key: 'conduct_improvement',
    name: 'Conduct improvement',
    nameRw: 'Iterambere ry’imyitwarire',
    description: 'Celebrates a recognised improvement in a student’s conduct.',
    category: 'conduct_notifications',
    channel: 'whatsapp',
    en: {
      subject: 'Positive conduct update',
      body: `Dear Parent/Guardian,

We are pleased to inform you that {{studentName}} has demonstrated positive behavioural improvement and has been recognised for the following achievement:

{{title}}

We appreciate your continued support in encouraging positive behaviour.

Kind regards,
School Administration
ConductNexus.`,
    },
    rw: {
      subject: 'Amakuru y’imyitwarire myiza',
      body: `Mubyeyi/Murera,

Tunejejwe no kubamenyesha ko umwana wanyu {{studentName}} yagaragaje impinduka nziza mu myitwarire ye, akaba yashimwe kubera:

{{title}}

Turabashimira ubufatanye mukomeza kugaragaza mu gufasha umwana gukomeza kugira imyitwarire myiza.

Tubifurije amahoro.
Ubuyobozi bw’ishuri
ConductNexus.`,
    },
  },
  {
    key: 'follow_up_reminder',
    name: 'Follow-up reminder',
    nameRw: 'Kwibutsa gukurikirana',
    description: 'Reminds staff that a scheduled support follow-up is due.',
    category: 'conduct_notifications',
    channel: 'in_app',
    en: {
      subject: 'Follow-up reminder',
      body: `Follow-up Reminder

This is a reminder that the scheduled follow-up concerning {{studentName}} is due on {{dueDate}}.

Please ensure that the agreed actions are reviewed and documented.

ConductNexus — School Administration.`,
    },
    rw: {
      subject: 'Kwibutsa gukurikirana',
      body: `Kwibutsa Gukurikirana

Turabibutsa ko igihe cyo gukurikirana uko gahunda y’ubufasha n’imyitwarire ya {{studentName}} ishyirwa mu bikorwa kizaba ku wa {{dueDate}}.

Turabasaba gusuzuma ibikorwa byari byemeranyijweho no kubyandika mu nyandiko z’ishuri.

ConductNexus — Ubuyobozi bw’Ishuri.`,
    },
  },
  {
    key: 'high_risk',
    name: 'High-risk student alert',
    nameRw: 'Itangazo ry’umunyeshuri uri mu bucurika',
    description: 'Confidential alert to administrators when a student enters a risk band.',
    category: 'risk_and_support',
    channel: 'in_app',
    en: {
      subject: 'Student behaviour risk alert',
      body: `Student Behaviour Risk Alert

Dear School Administrator,

{{studentName}}, from {{className}}, has been assessed as being in the {{riskLevel}} risk category.

Current conduct balance: {{balance}} marks.

Please review the student's behaviour record and initiate appropriate support interventions.

This notification is confidential.

ConductNexus.`,
    },
    rw: {
      subject: 'Itangazo ry’urwego rw’imyitwarire y’umunyeshuri',
      body: `Itangazo ry’Urwego rw’Imyitwarire y’Umunyeshuri

Buyobozi bw’Ishuri,

Umunyeshuri {{studentName}} wo mu mwaka wa {{className}} yashyizwe mu rwego rw’ibyago byo kugira ibibazo by’imyitwarire rwa {{riskLevel}}.

Amanota asigaranye: {{balance}}.

Turabasaba gusuzuma amateka y’imyitwarire ye no gufata ingamba zikwiye zo kumufasha.

Aya makuru agomba kugirwa ibanga.

ConductNexus.`,
    },
  },
  {
    key: 'incident_deduction',
    name: 'Incident deduction alert',
    nameRw: 'Itangaziso ry’isoherezwa ry’amanota',
    description: 'Notifies guardians that conduct marks were deducted for a recorded incident.',
    category: 'incident_notifications',
    channel: 'whatsapp',
    en: {
      subject: 'Conduct update for {{studentName}}',
      body: `Dear Parent/Guardian,

We wish to inform you that an incident involving your child, {{studentName}}, has been recorded.

Incident: {{offenceName}}
Date: {{incidentDate}}
Marks deducted: {{deduction}}
Remaining conduct marks: {{balance}}

The school encourages your cooperation in guiding the student towards responsible behaviour.

For further information, please contact the school.

School Administration
ConductNexus.`,
    },
    rw: {
      subject: 'Amakuru y’imyitwarire ya {{studentName}}',
      body: `Mubyeyi/Murera,

Turabamenyesha ko mu ishuri hagaragaye ikibazo cy’imyitwarire cyerekeye umwana wanyu {{studentName}}.

Icyabaye: {{offenceName}}
Itariki byabereyeho: {{incidentDate}}
Amanota yakuweho: {{deduction}}
Amanota asigaranye: {{balance}}

Turabasaba gufatanya n’ishuri mu gufasha umwana kugira imyitwarire iboneye.

Ku bindi bisobanuro, mwahamagara cyangwa mukagana ubuyobozi bw’ishuri.

Ubuyobozi bw’Ishuri
ConductNexus.`,
    },
  },
  {
    key: 'meeting_invitation',
    name: 'Meeting invitation',
    nameRw: 'Ubutumire mu nama',
    description: 'Invites a guardian to a meeting about a student’s welfare and conduct.',
    category: 'parent_engagement',
    channel: 'whatsapp',
    en: {
      subject: 'Meeting invitation',
      body: `Dear Parent/Guardian,

You are respectfully invited to attend a meeting concerning the academic welfare and behaviour of {{studentName}}.

Meeting date: {{meetingDate}}
Time: {{meetingTime}}
Venue: {{venue}}

Your participation will be highly appreciated.

School Administration
ConductNexus.`,
    },
    rw: {
      subject: 'Ubutumire mu nama',
      body: `Mubyeyi/Murera,

Tubatumiriye mu nama igamije kuganira ku mibereho n’imyitwarire by’umwana wanyu {{studentName}}.

Itariki: {{meetingDate}}
Isaha: {{meetingTime}}
Ahazabera inama: {{venue}}

Kwitabira kwanyu ni ingenzi kandi bizadufasha gufatanya mu gushakira umwana ibisubizo bikwiye.

Ubuyobozi bw’Ishuri
ConductNexus.`,
    },
  },
  {
    key: 'serious_incident',
    name: 'Serious incident alert',
    nameRw: 'Itangaziso ry’icyerekezo gikomeye',
    description: 'Informs guardians that a serious incident is under review, without confidential detail.',
    category: 'incident_notifications',
    channel: 'whatsapp',
    en: {
      subject: 'Important school notice',
      body: `Dear Parent/Guardian,

We wish to inform you that a serious incident involving {{studentName}} has been reported at school.

The matter is currently being reviewed by the appropriate school authorities.

The school will communicate further information through the official communication channels.

We appreciate your cooperation.

School Administration
ConductNexus.`,
    },
    rw: {
      subject: 'Itangaziso rikomeye',
      body: `Mubyeyi/Murera,

Turabamenyesha ko mu ishuri hagaragaye ikibazo gikomeye cy’imyitwarire kirimo umwana wanyu {{studentName}}.

Iki kibazo kiri gusuzumwa n’inzego zibishinzwe mu buyobozi bw’ishuri.

Mu gihe hazaba hari andi makuru yemejwe, tuzabamenyesha binyuze mu nzira zemewe z’itumanaho ry’ishuri.

Turabashimira ubufatanye bwanyu.

Ubuyobozi bw’Ishuri
ConductNexus.`,
    },
  },
  {
    key: 'warning_letter',
    name: 'Warning letter notification',
    nameRw: 'Itangaziso ry’ibaruwa yemewe',
    description: 'Tells guardians that an official letter has been issued.',
    category: 'incident_notifications',
    channel: 'whatsapp',
    en: {
      subject: 'Official letter issued',
      body: `Dear Parent/Guardian,

Please be informed that an official {{letterType}} letter has been issued concerning {{studentName}}.

The official document has been made available through the school's designated communication channel.

For clarification, please contact the school administration.

ConductNexus.`,
    },
    rw: {
      subject: 'Ibaruwa yemewe yoherejwe',
      body: `Mubyeyi/Murera,

Turabamenyesha ko umwana wanyu {{studentName}} yahawe ibaruwa yemewe y’ubwoko bwa {{letterType}}.

Iyi baruwa yabashyiriweho binyuze mu nzira z’itumanaho zemewe n’ishuri.

Ku bindi bisobanuro, mwahamagara ubuyobozi bw’ishuri.

ConductNexus.`,
    },
  },
  {
    key: 'positive_behaviour_recognition',
    name: 'Positive behaviour recognition',
    nameRw: 'Kwishimira imyitwarire myiza',
    description: 'Congratulates a student recognised for discipline and responsibility.',
    category: 'conduct_notifications',
    channel: 'whatsapp',
    en: {
      subject: 'Positive behaviour recognition',
      body: `Congratulations!

{{studentName}} has been recognised by the school for demonstrating excellent discipline, responsibility and positive conduct.

Achievement: {{achievement}}
Date: {{date}}

We encourage the student to maintain these positive standards.`,
    },
    rw: {
      subject: 'Kwishimira imyitwarire myiza',
      body: `Twishimiye imyitwarire myiza!

Umunyeshuri {{studentName}} yashimwe n’ishuri kubera imyitwarire myiza, inshingano n’indangagaciro yagaragaje.

Icyo yashimiwe: {{achievement}}
Itariki: {{date}}

Turamushishikariza gukomeza kugira imyitwarire myiza no kuba urugero rwiza ku bandi banyeshuri.`,
    },
  },
  {
    key: 'student_improvement_plan',
    name: 'Student improvement plan',
    nameRw: 'Gahunda yo kunoza imyitwarire',
    description: 'Shares an improvement plan, required actions and review date with guardians.',
    category: 'student_improvement',
    channel: 'whatsapp',
    en: {
      subject: 'Student behaviour improvement plan',
      body: `Dear Parent/Guardian,

The school has initiated a behaviour improvement plan for {{studentName}}.

Improvement area: {{improvementArea}}
Action required: {{actionRequired}}
Review date: {{reviewDate}}

Your cooperation is important in helping the student achieve sustainable behavioural improvement.`,
    },
    rw: {
      subject: 'Gahunda yo kunoza imyitwarire y’umunyeshuri',
      body: `Mubyeyi/Murera,

Ishuri ryashyiriyeho umwana wanyu {{studentName}} gahunda igamije kunoza imyitwarire.

Icyo agomba kunoza: {{improvementArea}}
Ibikorwa bisabwa: {{actionRequired}}
Itariki yo gusuzuma intambwe yatewe: {{reviewDate}}

Ubufatanye bwanyu ni ingenzi mu gufasha umwana kugira impinduka zirambye mu myitwarire.`,
    },
  },
  {
    key: 'disciplinary_hearing_invitation',
    name: 'Disciplinary hearing invitation',
    nameRw: 'Ubutumire mu nama yo gusuzuma ikibazo',
    description: 'Invites a guardian to a formal disciplinary hearing.',
    category: 'appeals_and_decisions',
    channel: 'whatsapp',
    en: {
      subject: 'Disciplinary hearing invitation',
      body: `Dear Parent/Guardian,

You are invited to attend a disciplinary hearing concerning {{studentName}}.

Hearing date: {{hearingDate}}
Time: {{hearingTime}}
Venue: {{venue}}

The hearing will provide an opportunity for the matter to be examined fairly and for relevant explanations to be presented.

School Administration.`,
    },
    rw: {
      subject: 'Ubutumire mu nama yo gusuzuma ikibazo',
      body: `Mubyeyi/Murera,

Tubatumiriye kwitabira inama yo gusuzuma ikibazo cy’imyitwarire cyerekeye umwana wanyu {{studentName}}.

Itariki: {{hearingDate}}
Isaha: {{hearingTime}}
Ahantu: {{venue}}

Iyi nama igamije gusuzuma ikibazo mu mucyo no guha ababifitemo uruhare umwanya wo gutanga ibisobanuro.

Ubuyobozi bw’Ishuri.`,
    },
  },
  {
    key: 'suspension_notification',
    name: 'Suspension notification',
    nameRw: 'Itangazo ry’ihagarikwa ry’amasomo',
    description: 'Communicates a suspension decision, its period and the reason.',
    category: 'appeals_and_decisions',
    channel: 'whatsapp',
    en: {
      subject: 'Suspension notification',
      body: `Dear Parent/Guardian,

We wish to inform you that the school has issued a suspension decision concerning {{studentName}}.

Suspension period: {{startDate}} to {{endDate}}
Reason: {{reason}}

Please contact the school administration for the official decision and instructions regarding the student's return.

ConductNexus.`,
    },
    rw: {
      subject: 'Itangazo ry’ihagarikwa ry’amasomo',
      body: `Mubyeyi/Murera,

Turabamenyesha ko ubuyobozi bw’ishuri bwafashe icyemezo cyo guhagarika by’agateganyo umunyeshuri {{studentName}} kwiga mu gihe runaka.

Igihe azamara ahagaritswe: kuva ku wa {{startDate}} kugeza ku wa {{endDate}}.
Impamvu: {{reason}}

Turabasaba kuvugana n’ubuyobozi bw’ishuri kugira ngo muhabwe icyemezo cyemewe n’amabwiriza agenga igihe umunyeshuri azasubirira mu ishuri.

ConductNexus.`,
    },
  },
  {
    key: 'appeal_acknowledgement',
    name: 'Appeal acknowledgement',
    nameRw: 'Ukwakira ubujurire',
    description: 'Confirms receipt of an appeal and quotes its reference number.',
    category: 'appeals_and_decisions',
    channel: 'whatsapp',
    en: {
      subject: 'Appeal received',
      body: `Dear {{recipientName}},

Your appeal concerning {{studentName}} has been successfully received.

Reference number: {{appealReference}}
Submission date: {{submissionDate}}

The school will review the appeal in accordance with its disciplinary procedures.

ConductNexus.`,
    },
    rw: {
      subject: 'Ukwakira ubujurire',
      body: `Mwaramutse {{recipientName}},

Turabamenyesha ko ubusabe bwo kujuririra icyemezo cyafashwe ku kibazo cya {{studentName}} bwakiriwe neza.

Nomero iranga ubujurire: {{appealReference}}
Itariki bwakiriweho: {{submissionDate}}

Ubuyobozi bw’ishuri buzabusuzuma hakurikijwe amabwiriza agenga ibibazo by’imyitwarire.

ConductNexus.`,
    },
  },
  {
    key: 'appeal_decision',
    name: 'Appeal decision',
    nameRw: 'Icyemezo ku bujurire',
    description: 'Communicates the outcome and reasoning of an appeal.',
    category: 'appeals_and_decisions',
    channel: 'whatsapp',
    en: {
      subject: 'Appeal decision',
      body: `Dear {{recipientName}},

The appeal concerning {{studentName}} has been reviewed.

Decision: {{decision}}
Explanation: {{explanation}}
Decision date: {{decisionDate}}

For further information, please contact the school administration.`,
    },
    rw: {
      subject: 'Icyemezo ku bujurire',
      body: `Mwaramutse {{recipientName}},

Turabamenyesha ko ubujurire bwatanzwe ku kibazo cya {{studentName}} bwasuzumwe.

Icyemezo cyafashwe: {{decision}}
Ibisobanuro: {{explanation}}
Itariki icyemezo cyafatiweho: {{decisionDate}}

Ku bindi bisobanuro, mwavugana n’ubuyobozi bw’ishuri.`,
    },
  },
  {
    key: 'parent_contact_update',
    name: 'Parent contact information update',
    nameRw: 'Kuvugurura amakuru y’itumanaho',
    description: 'Asks guardians to verify or update the contact details on record.',
    category: 'parent_engagement',
    channel: 'whatsapp',
    en: {
      subject: 'Please verify your contact details',
      body: `Dear Parent/Guardian,

The school requests that you verify or update your contact information for {{studentName}}.

Please ensure that the following information is accurate:

Phone: {{phone}}
Email: {{email}}

Accurate contact information helps the school communicate important student updates.`,
    },
    rw: {
      subject: 'Nyamuneka yemeje amakuru y’itumanaho',
      body: `Mubyeyi/Murera,

Ishuri rirabasaba kugenzura no kuvugurura amakuru y’aho ribabariza ku birebana n’umwana wanyu {{studentName}}.

Nomero ya telefoni: {{phone}}
Imeyili: {{email}}

Amakuru y’itumanaho yizewe afasha ishuri kubagezaho amakuru y’ingenzi yerekeye umwana wanyu.`,
    },
  },
  {
    key: 'class_announcement',
    name: 'Class or school-wide announcement',
    nameRw: 'Itangazo ry’ishuri',
    description: 'Sends an announcement to a class, stream or the whole school.',
    category: 'general_communications',
    channel: 'whatsapp',
    en: {
      subject: 'School announcement',
      body: `School Announcement

This is to inform you of an important school communication concerning {{className}}.

Announcement: {{announcement}}
Effective date: {{effectiveDate}}

Please follow the instructions provided by the school administration.

ConductNexus.`,
    },
    rw: {
      subject: 'Itangazo ry’ishuri',
      body: `Itangazo ry’Ishuri

Turabamenyesha amakuru y’ingenzi areba abanyeshuri bo mu mwaka wa {{className}}.

Ibyerekeye itangazo: {{announcement}}
Itariki rizatangiriraho: {{effectiveDate}}

Turabasaba gukurikiza amabwiriza yatanzwe n’ubuyobozi bw’ishuri.

ConductNexus.`,
    },
  },
  {
    key: 'student_return_reminder',
    name: 'Student return-to-school reminder',
    nameRw: 'Kwibutsa gusubira ku ishuri',
    description: 'Reminds guardians of a student’s scheduled return date and instructions.',
    category: 'student_improvement',
    channel: 'whatsapp',
    en: {
      subject: 'Student return-to-school reminder',
      body: `Dear Parent/Guardian,

This is a reminder concerning the scheduled return of {{studentName}} to school.

Return date: {{returnDate}}
Instructions: {{instructions}}

Please ensure that the student follows the instructions issued by the school.`,
    },
    rw: {
      subject: 'Kwibutsa gusubira ku ishuri',
      body: `Mubyeyi/Murera,

Turabibutsa ibirebana n’itariki umwana wanyu {{studentName}} ateganyijwe gusubirira ku ishuri.

Itariki yo kugaruka: {{returnDate}}
Amabwiriza agomba gukurikizwa: {{instructions}}

Turabasaba kureba ko umwana yubahiriza amabwiriza yahawe n’ishuri.`,
    },
  },
  {
    key: 'parent_meeting_followup',
    name: 'Parent meeting follow-up',
    nameRw: 'Gukurikirana inama',
    description: 'Records what was agreed at a parent meeting and the next review date.',
    category: 'parent_engagement',
    channel: 'whatsapp',
    en: {
      subject: 'Meeting follow-up',
      body: `Dear Parent/Guardian,

Thank you for attending the meeting concerning {{studentName}}.

Meeting date: {{meetingDate}}
Agreed actions: {{agreedActions}}
Next review date: {{nextReviewDate}}

We appreciate your continued partnership.`,
    },
    rw: {
      subject: 'Gukurikirana inama',
      body: `Mubyeyi/Murera,

Turabashimira ko mwitabiriye inama yerekeye umwana wanyu {{studentName}}.

Itariki y’inama: {{meetingDate}}
Ibyumvikanyweho: {{agreedActions}}
Itariki yo kongera gusuzuma ibyumvikanyweho: {{nextReviewDate}}

Turabashimira ubufatanye mukomeza kugaragaza.`,
    },
  },
  {
    key: 'investigation_update',
    name: 'Investigation update',
    nameRw: 'Amakuru mashya y’iperereza',
    description: 'Shares investigation status by reference only, with no confidential detail.',
    category: 'investigation',
    channel: 'whatsapp',
    en: {
      subject: 'Investigation update',
      body: `Dear {{recipientName}},

An update concerning the investigation involving {{studentName}} is available.

Reference: {{caseReference}}
Status: {{investigationStatus}}

The matter is being handled confidentially and in accordance with school procedures.`,
    },
    rw: {
      subject: 'Amakuru mashya y’iperereza',
      body: `Mwaramutse {{recipientName}},

Turabamenyesha ko hari amakuru mashya yerekeye iperereza ku kibazo kirimo {{studentName}}.

Nomero y’ikibazo: {{caseReference}}
Imiterere y’iperereza: {{investigationStatus}}

Iki kibazo kirimo gukurikiranwa mu ibanga no hakurikijwe amabwiriza agenga ishuri.`,
    },
  },
  {
    key: 'parent_consent_request',
    name: 'Parent consent request',
    nameRw: 'Gusaba uruhushya',
    description: 'Requests and tracks guardian consent with an explicit deadline.',
    category: 'parent_engagement',
    channel: 'whatsapp',
    en: {
      subject: 'Consent request',
      body: `Dear Parent/Guardian,

The school requests your consent concerning {{requestDescription}} for {{studentName}}.

Please review the request and provide your response through the school's official communication channel.

Consent deadline: {{deadline}}.`,
    },
    rw: {
      subject: 'Gusaba uruhushya',
      body: `Mubyeyi/Murera,

Ishuri rirabasaba gutanga uruhushya ku bijyanye na {{requestDescription}} bireba umwana wanyu {{studentName}}.

Turabasaba gusuzuma ubu busabe no gutanga igisubizo binyuze mu nzira zemewe z’itumanaho ry’ishuri.

Igihe ntarengwa cyo gutanga igisubizo: {{deadline}}.`,
    },
  },
  {
    key: 'incident_report_acknowledgement',
    name: 'New incident report acknowledgement',
    nameRw: 'Icyatanzwe cyakiriwe',
    description: 'Confirms that a reported incident has been registered and assigned a reference.',
    category: 'incident_notifications',
    channel: 'whatsapp',
    en: {
      subject: 'Incident report received',
      body: `Dear {{recipientName}},

A reported incident concerning {{studentName}} has been received and registered.

Incident reference: {{incidentReference}}
Reported date: {{reportedDate}}
Current status: {{status}}

The school will review the information and take appropriate action in accordance with its policies.`,
    },
    rw: {
      subject: 'Icyatanzwe cyakiriwe',
      body: `Mwaramutse {{recipientName}},

Turabamenyesha ko amakuru yatanzwe ku kibazo cy’imyitwarire cyerekeye {{studentName}} yakiriwe kandi akandikwa mu nyandiko z’ishuri.

Nomero iranga ikibazo: {{incidentReference}}
Itariki cyatangarijweho: {{reportedDate}}
Imiterere yacyo ubu: {{status}}

Ishuri rizasuzuma ayo makuru kandi rifate ingamba zikwiye hakurikijwe amabwiriza arigenga.`,
    },
  },
  {
    key: 'general_communication',
    name: 'General school communication',
    nameRw: 'Itumanaho rikuru ry’ishuri',
    description: 'A general-purpose message for anything not covered by a specific template.',
    category: 'general_communications',
    channel: 'whatsapp',
    en: {
      subject: 'School communication',
      body: `Dear Parent/Guardian,

The school wishes to communicate the following important information concerning {{studentName}}.

Subject: {{subject}}
Message: {{message}}
Date: {{date}}

For further clarification, please contact the school administration.`,
    },
    rw: {
      subject: 'Itumanaho ry’ishuri',
      body: `Mubyeyi/Murera,

Ishuri ririfuza kubagezaho amakuru akurikira arebana n’umwana wanyu {{studentName}}.

Ingingo: {{subject}}
Ubutumwa: {{message}}
Itariki: {{date}}

Ku bisobanuro birambuye, mwavugana n’ubuyobozi bw’ishuri.`,
    },
  },
]

// ── 2. Official letter templates (9 types × EN/RW) ──────────────────────────
//
// Letter templates hold the subject and formal body. The PDF renderer supplies
// the school identity block, reference number, date, recipient and student
// details, so those are not repeated inside the stored body.

export const LETTER_TEMPLATE_LIBRARY: BilingualLetterTemplate[] = [
  {
    type: 'conduct_report',
    name: 'Student conduct report',
    nameRw: 'Raporo y’imyitwarire y’umunyeshuri',
    description: 'Official summary of a student’s conduct record for the term.',
    category: 'official_letters',
    en: {
      subject: 'OFFICIAL STUDENT CONDUCT REPORT',
      body: `Dear Parent/Guardian,

This report provides an official summary of the conduct record of {{studentName}}, currently studying in {{className}}.

Student information:
Full name: {{studentName}}
Student number: {{studentId}}
Class: {{className}}
Academic year: {{academicYear}}
Term: {{term}}

Conduct summary:
Starting conduct marks: {{startingMarks}}
Total marks deducted: {{totalDeductions}}
Current conduct balance: {{balance}}

Summary of recorded incidents:
{{incidentHistory}}

Positive behavioural observations:
{{positiveObservations}}

Recommendations:
{{recommendations}}

The school encourages continued cooperation between the parent/guardian and the school to support the student's discipline, personal development and academic progress.`,
    },
    rw: {
      subject: 'RAPORO YEMEWE Y’IMYITWARIRE Y’UMUNYESHURI',
      body: `Mubyeyi/Murera,

Iyi baruwa igamije kubagezaho raporo yemewe y’imyitwarire y’umunyeshuri {{studentName}}, wiga mu mwaka wa {{className}}.

Amakuru y’umunyeshuri:
Amazina: {{studentName}}
Nomero y’umunyeshuri: {{studentId}}
Umwaka yigamo: {{className}}
Umwaka w’amashuri: {{academicYear}}
Igihembwe: {{term}}

Incamake y’amanota y’imyitwarire:
Amanota yatangiranye: {{startingMarks}}
Amanota yose yakuweho: {{totalDeductions}}
Amanota asigaranye: {{balance}}

Incamake y’ibibazo by’imyitwarire byanditswe:
{{incidentHistory}}

Imyitwarire myiza yagaragaje:
{{positiveObservations}}

Ibyifuzo n’ingamba:
{{recommendations}}

Ishuri rirabasaba gukomeza gufatanya naryo mu gufasha umwana kugira imyitwarire myiza, kwiteza imbere no gutsinda amasomo.`,
    },
  },
  {
    type: 'expulsion_decision',
    name: 'Expulsion decision',
    nameRw: 'Icyemezo co gusezerera umunyeshuri',
    description: 'Records a final, approved expulsion decision.',
    category: 'official_letters',
    en: {
      subject: 'OFFICIAL EXPULSION DECISION',
      body: `Student: {{studentName}}
Class: {{className}}
Student ID: {{studentId}}

Dear Parent/Guardian,

Following the disciplinary proceedings concerning {{studentName}}, the competent school authorities have reached the following decision:

Decision: {{decision}}
Reason: {{reason}}
Effective date: {{effectiveDate}}

This decision has been made following the applicable school disciplinary procedures and the relevant approval process.

Please contact the school administration to receive the official documentation and further guidance.`,
    },
    rw: {
      subject: 'ICYEMEZO CYO GUSEZERERA UMUNYESHURI KU ISHURI',
      body: `Umunyeshuri: {{studentName}}
Umwaka yigamo: {{className}}
Nomero ye: {{studentId}}

Mubyeyi/Murera,

Nyuma yo gusuzuma ikibazo cy’imyitwarire cyerekeye {{studentName}}, inzego zibifitiye ububasha mu buyobozi bw’ishuri zafashe icyemezo gikurikira:

Icyemezo: {{decision}}
Impamvu: {{reason}}
Itariki kizatangiriraho: {{effectiveDate}}

Iki cyemezo cyafashwe hakurikijwe amabwiriza agenga imyitwarire y’abanyeshuri n’inzira zemewe zo kwemeza ibyemezo by’ishuri.

Turabasaba kugana ubuyobozi bw’ishuri kugira ngo muhabwe inyandiko zemewe n’ibisobanuro birambuye.`,
    },
  },
  {
    type: 'expulsion_recommendation',
    name: 'Expulsion recommendation',
    nameRw: 'Igitekerezo cyo gusezerera umunyeshuri',
    description: 'A recommendation only — never a final expulsion decision.',
    category: 'official_letters',
    en: {
      subject: 'RECOMMENDATION FOR STUDENT EXPULSION',
      body: `Student: {{studentName}}
Class: {{className}}

This document presents a recommendation concerning the disciplinary case involving {{studentName}}.

Incident summary:
{{incidentSummary}}

Investigation findings:
{{investigationFindings}}

Previous disciplinary interventions:
{{previousActions}}

Recommendation:
{{recommendation}}

Supporting documentation:
{{supportingEvidence}}

This is a recommendation for consideration by the competent school authorities. It is not a final expulsion decision.`,
    },
    rw: {
      subject: 'IGITEKEREZO CYO GUSEZERERA UMUNYESHURI KU ISHURI',
      body: `Umunyeshuri: {{studentName}}
Umwaka yigamo: {{className}}

Iyi nyandiko ikubiyemo igitekerezo ku kibazo cy’imyitwarire cyerekeye {{studentName}}.

Incamake y’ibyabaye:
{{incidentSummary}}

Ibyagaragajwe n’iperereza:
{{investigationFindings}}

Ingamba zari zarafashwe mbere:
{{previousActions}}

Igitekerezo gitanzwe:
{{recommendation}}

Inyandiko n’ibimenyetso bishyigikira iki gitekerezo:
{{supportingEvidence}}

Iyi nyandiko ni igitekerezo gisaba gusuzumwa n’inzego zibifitiye ububasha mu buyobozi bw’ishuri. Si icyemezo cya nyuma cyo gusezerera umunyeshuri.`,
    },
  },
  {
    type: 'hearing_invitation',
    name: 'Disciplinary hearing invitation',
    nameRw: 'Ubutumire mu nama yo gusuzuma ikibazo',
    description: 'Formal invitation to a disciplinary hearing.',
    category: 'official_letters',
    en: {
      subject: 'INVITATION TO DISCIPLINARY HEARING',
      body: `Dear Parent/Guardian,

You are formally invited to attend a disciplinary hearing concerning {{studentName}}.

Details:
Date: {{hearingDate}}
Time: {{hearingTime}}
Venue: {{venue}}

Purpose:
{{hearingPurpose}}

The hearing provides an opportunity for the relevant parties to present explanations and information before any final decision is made.

Please attend the meeting or contact the school if you are unable to do so.`,
    },
    rw: {
      subject: 'UBUTUMIRE MU NAMA YO GUSUZUMA IKIBAZO CY’IMYITWARIRE',
      body: `Mubyeyi/Murera,

Tubandikiye tubatumira mu nama yo gusuzuma ikibazo cy’imyitwarire cyerekeye umwana wanyu {{studentName}}.

Ibisobanuro by’inama:
Itariki: {{hearingDate}}
Isaha: {{hearingTime}}
Ahantu: {{venue}}

Impamvu y’inama:
{{hearingPurpose}}

Iyi nama izatanga umwanya wo kumva ibisobanuro n’ibitekerezo by’abafitanye isano n’iki kibazo mbere y’uko hafatwa icyemezo cya nyuma.

Turabasaba kuzitabira iyi nama cyangwa mukamenyesha ubuyobozi bw’ishuri igihe mutabashije kuyitabira.`,
    },
  },
  {
    type: 'improvement_notice',
    name: 'Student improvement notice',
    nameRw: 'Ibaruwa isaba kunoza imyitwarire',
    description: 'Formal notice of conduct areas requiring improvement.',
    category: 'official_letters',
    en: {
      subject: 'STUDENT BEHAVIOUR IMPROVEMENT NOTICE',
      body: `Dear Parent/Guardian,

The school has identified areas requiring improvement in the conduct of {{studentName}}.

Areas requiring improvement:
{{improvementAreas}}

Expected behavioural standards:
{{expectedStandards}}

Agreed improvement actions:
{{improvementActions}}

Monitoring period:
{{startDate}} to {{endDate}}

Review date: {{reviewDate}}

The school believes that cooperation between the student, parent/guardian and teachers is essential for achieving positive and lasting behavioural change.`,
    },
    rw: {
      subject: 'IBARUWA ISABA UMUNYESHURI KUNOZA IMYITWARIRE',
      body: `Mubyeyi/Murera,

Ishuri ryagaragaje ibintu bimwe na bimwe umwana wanyu {{studentName}} akeneye kunoza mu myitwarire.

Imyitwarire ikwiye kunozwa:
{{improvementAreas}}

Imyitwarire yitezwe:
{{expectedStandards}}

Ibikorwa byemeranyijweho kugira ngo imyitwarire inozwe:
{{improvementActions}}

Igihe cyo gukurikirana impinduka:
Kuva ku wa {{startDate}} kugeza ku wa {{endDate}}

Itariki yo gusuzuma intambwe yatewe: {{reviewDate}}

Ishuri ribona ko ubufatanye bw’umunyeshuri, ababyeyi cyangwa abamurera n’abarimu ari ingenzi kugira ngo haboneke impinduka nziza kandi zirambye mu myitwarire.`,
    },
  },
  {
    type: 'parent_meeting_invitation',
    name: 'Parent meeting invitation',
    nameRw: 'Ubutumire mu nama y’ababyeyi',
    description: 'Formal invitation to a parent meeting with an agenda.',
    category: 'official_letters',
    en: {
      subject: 'OFFICIAL INVITATION TO PARENT MEETING',
      body: `Dear {{recipientName}},

The school respectfully invites you to attend a meeting concerning {{studentName}}.

Meeting details:
Date: {{meetingDate}}
Time: {{meetingTime}}
Venue: {{venue}}

Meeting agenda:
{{agenda}}

Your presence and contribution are important in supporting the student's welfare and development.`,
    },
    rw: {
      subject: 'UBUTUMIRE MU NAMA Y’ABABYEYI',
      body: `Mubyeyi/Murera {{recipientName}},

Ubuyobozi bw’ishuri burabatumiye mu nama yerekeye umwana wanyu {{studentName}}.

Ibisobanuro by’inama:
Itariki: {{meetingDate}}
Isaha: {{meetingTime}}
Ahantu: {{venue}}

Ibyigwa mu nama:
{{agenda}}

Kwitabira kwanyu no gutanga ibitekerezo bizafasha ishuri mu gukurikirana imibereho myiza n’iterambere ry’umwana wanyu.`,
    },
  },
  {
    type: 'serious_incident',
    name: 'Serious incident notification letter',
    nameRw: 'Ibaruwa imenyesha ikibazo gikomeye',
    description: 'Formal notice of a serious incident, without confidential investigation detail.',
    category: 'official_letters',
    en: {
      subject: 'OFFICIAL NOTIFICATION OF SERIOUS STUDENT INCIDENT',
      body: `Dear Parent/Guardian,

The school wishes to formally notify you of a serious incident involving {{studentName}}.

Incident date: {{incidentDate}}
Incident description: {{incidentDescription}}
Current investigation status: {{investigationStatus}}

The school is reviewing the matter in accordance with its established procedures.

The school will communicate verified information and any necessary next steps through the appropriate official channels.`,
    },
    rw: {
      subject: 'IBARUWA IMENYESHA IKIBAZO GIKOMEYE CY’IMYITWARIRE Y’UMUNYESHURI',
      body: `Mubyeyi/Murera,

Ubuyobozi bw’ishuri burabandikira kugira ngo bubamenyeshe ku mugaragaro ikibazo gikomeye cy’imyitwarire kirimo umwana wanyu {{studentName}}.

Itariki byabereyeho: {{incidentDate}}
Ibisobanuro by’ibyabaye: {{incidentDescription}}
Aho iperereza rigeze: {{investigationStatus}}

Ishuri ririmo gusuzuma iki kibazo hakurikijwe amabwiriza n’inzira zemewe naryo.

Amakuru yemejwe n’izindi ngamba zikenewe muzabimenyeshwa binyuze mu nzira zemewe z’itumanaho ry’ishuri.`,
    },
  },
  {
    type: 'suspension',
    name: 'Suspension letter',
    nameRw: 'Ibaruwa y’ihagarikwa ry’amasomo',
    description: 'Formal suspension decision with return conditions.',
    category: 'official_letters',
    en: {
      subject: 'OFFICIAL STUDENT SUSPENSION DECISION',
      body: `Dear Parent/Guardian,

Following the review and approval of the disciplinary matter concerning {{studentName}}, the school hereby communicates the suspension decision.

Student: {{studentName}}
Class: {{className}}
Reason: {{reason}}

Suspension start date: {{startDate}}
Suspension end date: {{endDate}}

Conditions for returning to school:
{{returnConditions}}

This decision is subject to the applicable school policies and approval procedures.

Please contact the school administration for further clarification.`,
    },
    rw: {
      subject: 'ICYEMEZO CYO GUHAGARIKA UMWANZURO W’AMASHURI W’UMUNYESHURI BY’AGATEGANYO',
      body: `Mubyeyi/Murera,

Nyuma yo gusuzuma no kwemeza ikibazo cy’imyitwarire cyerekeye {{studentName}}, ubuyobozi bw’ishuri burabamenyesha icyemezo cyo guhagarika uyu munyeshuri kwiga by’agateganyo.

Umunyeshuri: {{studentName}}
Umwaka yigamo: {{className}}
Impamvu: {{reason}}

Itariki atangiriraho guhagarikwa: {{startDate}}
Itariki azasubiriraho: {{endDate}}

Ibisabwa kugira ngo yemererwe gusubira mu ishuri:
{{returnConditions}}

Iki cyemezo cyafashwe hakurikijwe amabwiriza y’ishuri n’inzira zemewe zo kwemeza ibihano.

Ku bindi bisobanuro, mwavugana n’ubuyobozi bw’ishuri.`,
    },
  },
  {
    type: 'warning',
    name: 'Official warning letter',
    nameRw: 'Ibaruwa y’umuburo',
    description: 'Formal disciplinary warning letter.',
    category: 'official_letters',
    en: {
      subject: 'OFFICIAL DISCIPLINARY WARNING',
      body: `Dear {{recipientName}},

This letter serves as an official warning concerning the conduct of {{studentName}}.

Incident or conduct concern:
{{incidentDescription}}

Date of incident:
{{incidentDate}}

Previous interventions:
{{previousInterventions}}

Expected corrective action:
{{correctiveAction}}

The student is expected to demonstrate immediate and sustained improvement in behaviour.

The school encourages the parent/guardian to work closely with the school in supporting the student's positive development.`,
    },
    rw: {
      subject: 'IBARUWA Y’UMUBURO KU MYITWARIRE Y’UMUNYESHURI',
      body: `Mubyeyi/Murera {{recipientName}},

Iyi baruwa ni umuburo utanzwe ku mugaragaro ku bijyanye n’imyitwarire y’umwana wanyu {{studentName}}.

Icyabaye cyangwa ikibazo cyagaragaye mu myitwarire:
{{incidentDescription}}

Itariki byabereyeho:
{{incidentDate}}

Ingamba zari zarafashwe mbere:
{{previousInterventions}}

Ibikorwa umunyeshuri asabwa gukosora:
{{correctiveAction}}

Umunyeshuri arasabwa kugaragaza impinduka nziza mu myitwarire ye vuba kandi agakomeza kuzubahiriza.

Ishuri rirashishikariza ababyeyi cyangwa abamurera gukomeza gukorana naryo kugira ngo bafashe umwana kwiteza imbere no kugira imyitwarire iboneye.`,
    },
  },
]

/**
 * Placeholders every template may receive from the rendering layer, whether or
 * not a given template uses them. Used to build realistic previews.
 */
export const COMMON_PLACEHOLDER_SAMPLES: Record<string, string> = {
  studentName: 'Aline Uwase',
  studentId: 'STU-2026-0142',
  className: 'Senior Four A',
  parentName: 'Mr. Jean Bosco Habimana',
  recipientName: 'Mr. Jean Bosco Habimana',
  offenceName: 'Late arrival to class',
  incidentDate: '12 March 2026',
  deduction: '3',
  balance: '38',
  riskLevel: 'high',
  meetingDate: '20 March 2026',
  meetingTime: '10:00',
  venue: 'School Administration Block, Room 2',
  letterType: 'warning',
  schoolName: 'ConductNexus Demonstration Secondary School',
  schoolAddress: 'KG 11 Ave, Kigali, Rwanda',
  referenceNumber: 'CN/REF/2026/0031',
  academicYear: '2026-2027',
  term: 'Term 1',
  signatoryName: 'Mrs. Claudine Mukamana',
  signatoryTitle: 'Headteacher',
  title: 'Most improved learner of the term',
  achievement: 'Perfect attendance and peer leadership',
  date: '12 March 2026',
  dueDate: '25 March 2026',
  improvementArea: 'Punctuality',
  actionRequired: 'Sign the daily attendance register on arrival',
  reviewDate: '10 April 2026',
  hearingDate: '18 March 2026',
  hearingTime: '09:00',
  startDate: '17 March 2026',
  endDate: '24 March 2026',
  reason: 'Repeated lateness after two warnings',
  appealReference: 'APL-2026-004',
  submissionDate: '12 March 2026',
  decision: 'Appeal upheld in part',
  explanation: 'The deduction stands; the suspension is reduced by three days.',
  decisionDate: '19 March 2026',
  phone: '+250 788 000 000',
  email: 'parent@example.rw',
  announcement: 'School closes early on Friday for staff training.',
  effectiveDate: '20 March 2026',
  returnDate: '25 March 2026',
  instructions: 'Report to the Deputy Headteacher on arrival.',
  agreedActions: 'Daily attendance monitoring and weekly guardian call.',
  nextReviewDate: '17 April 2026',
  caseReference: 'INV-2026-009',
  investigationStatus: 'Under review',
  requestDescription: 'participation in the weekend sports programme',
  deadline: '30 March 2026',
  incidentReference: 'INC-2026-0231',
  reportedDate: '12 March 2026',
  status: 'Under review',
  subject: 'School fees payment schedule',
  message: 'The second instalment is due on 30 March 2026.',
  startingMarks: '40',
  totalDeductions: '2',
  incidentHistory: '12 March 2026 — Late arrival to class (3 marks)',
  positiveObservations: 'Consistent leadership during group work.',
  recommendations: 'Continue current support plan and review in April.',
  incidentSummary: 'Repeated physical altercation with a fellow student.',
  investigationFindings: 'Witness statements confirm the student initiated the incident.',
  previousActions: 'Two verbal warnings and a behaviour improvement plan.',
  recommendation: 'Recommend expulsion subject to Headteacher approval.',
  supportingEvidence: 'Incident reports 231 and 244, witness statements, guardian meeting notes.',
  hearingPurpose: 'To hear the student and guardian before a final decision.',
  improvementAreas: 'Punctuality and respect for prefects.',
  expectedStandards: 'Arrive before 07:00 and follow prefect instructions.',
  improvementActions: 'Daily check-in with the class teacher for two weeks.',
  returnConditions: 'A written apology and a guardian meeting before re-admission.',
  incidentDescription: 'Repeated physical altercation with a fellow student.',
  previousInterventions: 'Two verbal warnings and a behaviour improvement plan.',
  correctiveAction: 'Written apology and weekly conduct review.',
  agenda: 'Academic progress, conduct, and support at home.',
  preparedBy: 'Mr. Eric Nshimiyimana, Deputy Headteacher — Discipline',
  preparedDate: '12 March 2026',
  approverName: 'Mrs. Claudine Mukamana, Headteacher',
}