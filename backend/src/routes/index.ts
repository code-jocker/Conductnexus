import { Router } from 'express'
import authRouter from './auth.routes.js'
import usersRouter from './users.routes.js'
import structureRouter from './structure.routes.js'
import studentsRouter from './students.routes.js'
import promotionsRouter from './promotions.routes.js'
import parentsRouter from './parents.routes.js'
import disciplineRouter from './discipline.routes.js'
import approvalsRouter from './approvals.routes.js'
import riskRouter from './risk.routes.js'
import safeguardingRouter from './safeguarding.routes.js'
import investigationsRouter from './investigations.routes.js'
import appealsRouter from './appeals.routes.js'
import evidenceRouter from './evidence.routes.js'
import policiesRouter from './policies.routes.js'
import meetingsRouter from './meetings.routes.js'
import communicationsRouter from './communications.routes.js'
import { reportsRouter } from './reports.routes.js'
import { adminRouter } from './admin.routes.js'
import { portalRouter } from './portal.routes.js'
import { syncRouter } from './sync.routes.js'
import { attendanceRouter } from './attendance.routes.js'
import { boardingRouter } from './boarding.routes.js'
import welfareRouter from './welfare.routes.js'
import detentionRouter from './detention.routes.js'
import engagementRouter from './engagement.routes.js'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use(usersRouter)
apiRouter.use(structureRouter)
apiRouter.use(studentsRouter)
apiRouter.use(promotionsRouter)
apiRouter.use(attendanceRouter)
apiRouter.use(boardingRouter)
apiRouter.use(welfareRouter)
apiRouter.use(detentionRouter)
apiRouter.use(parentsRouter)
apiRouter.use(disciplineRouter)
apiRouter.use(approvalsRouter)
apiRouter.use(riskRouter)
apiRouter.use(safeguardingRouter)
apiRouter.use(investigationsRouter)
apiRouter.use(appealsRouter)
apiRouter.use(evidenceRouter)
apiRouter.use(policiesRouter)
apiRouter.use(meetingsRouter)
apiRouter.use(communicationsRouter)
apiRouter.use(reportsRouter)
apiRouter.use(adminRouter)
apiRouter.use(portalRouter)
apiRouter.use(engagementRouter)
apiRouter.use(syncRouter)
