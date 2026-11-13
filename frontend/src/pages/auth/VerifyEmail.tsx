import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MailCheck, XCircle } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button, LoadingBlock } from '../../components/ui'
import { apiError, post } from '../../lib/api'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const [state, setState] = useState<'pending' | 'working' | 'success' | 'error'>('pending')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setState('error')
      setMessage('This verification link is missing its token. Ask your administrator to resend the email from your profile.')
      return
    }
    setState('working')
    post('/auth/verify-email', { token })
      .then(() => {
        setState('success')
        setMessage('Your email address is verified. You can now sign in and receive conduct notifications.')
      })
      .catch((err) => {
        setState('error')
        setMessage(apiError(err))
      })
  }, [params])

  return (
    <AuthLayout eyebrow="Email verification" title="Verify your email">
      {state === 'working' || state === 'pending' ? (
        <LoadingBlock label="Verifying your link…" />
      ) : state === 'success' ? (
        <div className="space-y-4 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
          <Link to="/login">
            <Button className="w-full">Go to sign in</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50">
            <XCircle className="h-7 w-7" />
          </span>
          <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
          <div className="flex flex-col gap-2">
            <Link to="/login">
              <Button variant="secondary" className="w-full">
                Back to sign in
              </Button>
            </Link>
            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
              <MailCheck className="h-3.5 w-3.5" /> Links expire after 24 hours.
            </p>
          </div>
        </div>
      )}
    </AuthLayout>
  )
}
