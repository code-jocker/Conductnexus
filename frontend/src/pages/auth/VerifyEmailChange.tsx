import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button, LoadingBlock } from '../../components/ui'
import { apiError, post } from '../../lib/api'

export function VerifyEmailChangePage() {
  const [params] = useSearchParams()
  const [state, setState] = useState<'working' | 'success' | 'error'>('working')
  const [message, setMessage] = useState('Verifying your new email address…')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setState('error')
      setMessage('This email-change link is missing its token.')
      return
    }
    post('/auth/verify-email-change', { token })
      .then((result: { message?: string }) => {
        setState('success')
        setMessage(result.message ?? 'Your email address has been changed and verified. Please sign in again.')
      })
      .catch((err) => {
        setState('error')
        setMessage(apiError(err))
      })
  }, [params])

  return (
    <AuthLayout eyebrow="Account security" title="Confirm your new email">
      {state === 'working' ? <LoadingBlock label="Verifying your new email…" /> : (
        <div className="space-y-4 text-center">
          <span className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${state === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {state === 'success' ? <CheckCircle2 className="h-7 w-7" /> : <XCircle className="h-7 w-7" />}
          </span>
          <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
          <Link to="/login"><Button className="w-full">Continue to sign in</Button></Link>
        </div>
      )}
    </AuthLayout>
  )
}
