import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const PRO_FEATURES = [
  'Unlimited AI meal plan generations',
  'One-tap meal swapping with smart suggestions',
  'Pantry photo scanner',
  'Per-day grocery list with shopping links',
  'Full recipe generation for every meal',
  'Export grocery lists',
  'Priority AI access with faster responses',
  'Early access to new features',
]

export default function SuccessPage() {
  const [status, setStatus] = useState('upgrading') // 'upgrading' | 'done' | 'error'

  useEffect(() => {
    async function upgrade() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          await supabase
            .from('users')
            .update({ tier: 'pro' })
            .eq('id', session.user.id)
        }
        setStatus('done')
      } catch {
        setStatus('done') // show success anyway — webhook handles it
      }
    }
    upgrade()
  }, [])

  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-card__icon">{status === 'upgrading' ? '⏳' : '🎉'}</div>
        <h1 className="success-card__title">
          {status === 'upgrading' ? 'Activating your plan…' : 'Welcome to SMRT Meals Pro!'}
        </h1>
        <p className="success-card__subtitle">
          {status === 'upgrading'
            ? 'Just a moment while we activate your account.'
            : 'Your account has been upgraded. All Pro features are now unlocked.'}
        </p>

        {status === 'done' && (
          <div className="success-features">
            <h3 className="success-features__heading">What's unlocked</h3>
            <ul className="success-features__list">
              {PRO_FEATURES.map((f, i) => (
                <li key={i} className="success-features__item">
                  <span className="success-features__check">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {status === 'done' && (
          <a href="/" className="success-back-btn">
            Start planning meals →
          </a>
        )}
      </div>
    </div>
  )
}
