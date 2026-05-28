import { useState, useRef, useEffect } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase.js'
import './App.css'

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_KEY,
  dangerouslyAllowBrowser: true,
})

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const ALL_WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DEFAULT_PROFILE = { name: '', restrictions: '', cuisines: '' }

function getActiveDays(planDays, startDay) {
  const startIdx = ALL_WEEK_DAYS.indexOf(startDay)
  return Array.from({ length: planDays }, (_, i) => ALL_WEEK_DAYS[(startIdx + i) % 7])
}

function getMealsList(mealTypes, customMeals) {
  switch (mealTypes) {
    case 'breakfast': return ['breakfast']
    case 'lunch':     return ['lunch']
    case 'dinner':    return ['dinner']
    case 'custom':    return ['breakfast', 'lunch', 'dinner'].filter(m => customMeals.has(m))
    default:          return ['breakfast', 'lunch', 'dinner']
  }
}

const AMAZON_AFFILIATE_TAG  = 'crydalch7-20'
const WALMART_AFFILIATE_TAG = '' // add Walmart affiliate tag here when ready

function amazonUrl(query) {
  const base = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`
  return AMAZON_AFFILIATE_TAG ? `${base}&tag=${AMAZON_AFFILIATE_TAG}` : base
}

function walmartUrl(query) {
  const base = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`
  return WALMART_AFFILIATE_TAG ? `${base}&affiliates=${WALMART_AFFILIATE_TAG}` : base
}

function isOverloaded(err) {
  return (
    err?.status === 529 ||
    err?.error?.type === 'overloaded_error' ||
    String(err?.message).toLowerCase().includes('overloaded')
  )
}

async function withRetry(fn, { retries = 3, delayMs = 3000, onRetry } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (isOverloaded(err) && attempt < retries) {
        onRetry?.(attempt + 1)
        await new Promise(r => setTimeout(r, delayMs))
      } else {
        throw err
      }
    }
  }
}

const MEAL_META = {
  breakfast: { icon: '☀️', label: 'Breakfast' },
  lunch:     { icon: '🍴', label: 'Lunch' },
  dinner:    { icon: '🌙', label: 'Dinner' },
}

// Strip measurements, quantities, and prep words before building search URLs
function cleanIngredient(raw) {
  let s = raw.replace('✓', '').replace(/,.*$/, '').trim()
  s = s.replace(/^\d[\d\s./\-]*\s+/, '')   // leading numbers / fractions
  s = s.replace(/\b(cups?|tbsps?|tsps?|tablespoons?|teaspoons?|ounces?|oz\.?|lbs?|pounds?|grams?|g\.?|kg|ml|liters?|l\.|quarts?|pints?|cloves?|heads?|pieces?|slices?|sprigs?|bunchs?|bunches?|cans?|jars?|packets?|pkg|packages?|handfuls?|pinches?|dashes?)\b/gi, '')
  s = s.replace(/\b(diced|chopped|sliced|minced|thinly|roughly|coarsely|finely|cooked|uncooked|raw|fresh|dried|pitted|cubed|shredded|grated|peeled|crushed|trimmed|rinsed|halved|quartered|softened|melted|ground|deveined)\b/gi, '')
  s = s.replace(/\b(large|medium|small|whole|extra|virgin|pure|lean)\b/gi, '')
  return s.replace(/\s+/g, ' ').trim()
}

const WalmartIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2L13.5 8.5L19.5 6L15.5 11L22 12L15.5 13L19.5 18L13.5 15.5L12 22L10.5 15.5L4.5 18L8.5 13L2 12L8.5 11L4.5 6L10.5 8.5Z" fill="#0071CE"/>
  </svg>
)

const AmazonIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 16.5C7.5 20 12.5 21.5 18.5 19.5C19.5 19.1 21 18.2 21.5 17.5C21.8 17 21.5 16.8 21 17C19.5 17.6 14 19.5 8 17C6.5 16.4 5.2 15.5 4.2 14.5C3.7 14 3.2 14.2 3.5 16.5Z" fill="#FF9900"/>
    <path d="M19 14.5C19.8 13.8 20.5 13.2 20.5 12.5C20.5 11.8 20 11.5 19.5 11.8L18 12.8L17 11.3C16.7 10.8 16.2 11 16.2 11.7C16.2 12.4 16.8 13.5 17.5 14.2C18 14.7 18.5 14.9 19 14.5Z" fill="#FF9900"/>
  </svg>
)

const DIETARY_PRESETS = [
  { id: 'mexican',       label: 'Mexican',        icon: '🌮' },
  { id: 'mediterranean', label: 'Mediterranean',  icon: '🥗' },
  { id: 'dairy-free',   label: 'Dairy Free',     icon: '🌿' },
  { id: 'high-protein', label: 'High Protein',   icon: '💪' },
  { id: 'vegan',        label: 'Vegan',           icon: '🌱' },
  { id: 'asian-fusion', label: 'Asian Fusion',   icon: '🍜' },
]

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('mealPrepProfile')) || DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}

async function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1120
      let w = img.width, h = img.height
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX }
        else { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.src = url
  })
}

function parseMealContent(content) {
  const result = { breakfast: '', lunch: '', dinner: '', cost: '' }
  if (!content) return result
  for (const line of content.split('\n').filter(Boolean)) {
    const ll = line.toLowerCase()
    if (ll.startsWith('breakfast:'))      result.breakfast = line.slice(10).trim()
    else if (ll.startsWith('lunch:'))     result.lunch     = line.slice(6).trim()
    else if (ll.startsWith('dinner:'))    result.dinner    = line.slice(7).trim()
    else if (ll.includes('cost') || /^[•\-]/.test(line))
      result.cost = line.replace(/^[•\-]\s*/, '').trim()
  }
  return result
}

function parseRecipe(text) {
  const result = { prepTime: '', cookTime: '', servings: '', ingredients: [], instructions: [] }
  let section = null
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    const ll = line.toLowerCase()
    if (ll.startsWith('prep time:'))    { result.prepTime = line.slice(10).trim(); continue }
    if (ll.startsWith('cook time:'))    { result.cookTime = line.slice(10).trim(); continue }
    if (ll.startsWith('servings:'))     { result.servings  = line.slice(9).trim(); continue }
    if (ll.startsWith('ingredients'))   { section = 'ingredients'; continue }
    if (ll.startsWith('instructions'))  { section = 'instructions'; continue }
    if (section === 'ingredients' && /^[•\-\*]/.test(line))
      result.ingredients.push(line.replace(/^[•\-\*]\s*/, ''))
    else if (section === 'instructions' && /^\d+[.)]\s/.test(line))
      result.instructions.push(line.replace(/^\d+[.)]\s*/, ''))
  }
  return result
}

// ── Auth helpers ─────────────────────────────────────────────────────────────
const AUTH_ERROR_MAP = {
  'Invalid login credentials':                   'Incorrect email or password.',
  'User already registered':                     'An account with this email already exists. Try signing in.',
  'Password should be at least 6 characters':    'Password must be at least 8 characters.',
  'Email not confirmed':                         'Check your inbox to confirm your email, then sign in.',
  'Unable to validate email address':            'Please enter a valid email address.',
}

function friendlyAuthError(msg) {
  for (const [key, friendly] of Object.entries(AUTH_ERROR_MAP)) {
    if (msg.includes(key)) return friendly
  }
  return msg
}

const AVATAR_PALETTE = ['#7c3aed','#059669','#0284c7','#dc2626','#d97706','#be185d']
function avatarColor(str) {
  let h = 0
  for (const c of (str || '')) h = c.charCodeAt(0) + ((h << 5) - h)
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
}

function getDisplayName(user, profile) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    profile?.name ||
    user?.email?.split('@')[0] ||
    'Account'
  )
}

function getFirstName(displayName) {
  return displayName.split(' ')[0]
}

// ── Scarcity / testimonial constants ─────────────────────────────────────────
const COUNTDOWN_TARGET = new Date('2026-06-30T23:59:59').getTime()

function getCountdown() {
  const diff = Math.max(0, COUNTDOWN_TARGET - Date.now())
  return {
    days:  Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    mins:  Math.floor((diff % 3600000)  / 60000),
    secs:  Math.floor((diff % 60000)    / 1000),
  }
}

const TESTIMONIALS = [
  { text: 'Cut my grocery bill by $180 in the first month', author: 'Jane R.' },
  { text: 'Finally stopped wasting food. The pantry scanner is a game changer', author: 'Marcus T.' },
]

// ── AuthModal ─────────────────────────────────────────────────────────────────
function AuthModal({ initialMode = 'login', prompt = '', onClose, onSuccess }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // true = email signup verification; 'forgot' = reset sent
  const [emailSent, setEmailSent] = useState(false)
  const [resending, setResending] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [countdown, setCountdown] = useState(getCountdown)
  const [testimonialIdx, setTestimonialIdx] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setCountdown(getCountdown()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setTestimonialIdx(i => (i + 1) % TESTIMONIALS.length), 4500)
    return () => clearInterval(t)
  }, [])

  async function handleGoogleSignIn() {
    setGoogleLoading(true)
    setError('')
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      // Browser will redirect away — no further state updates needed
    } catch (err) {
      setError(err.message)
      setGoogleLoading(false)
    }
  }

  const pwReqs = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One number',            met: /\d/.test(password) },
    { label: 'One special character', met: /[^a-zA-Z0-9]/.test(password) },
  ]
  const pwValid = mode === 'login' || pwReqs.every(r => r.met)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function switchMode(m) {
    setMode(m); setError(''); setPassword(''); setShowPw(false)
  }

  async function handleForgotPassword() {
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setLoading(true); setError('')
    try {
      await supabase.auth.resetPasswordForEmail(email.trim())
      setEmailSent('forgot')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleResend() {
    setResending(true)
    try { await supabase.auth.resend({ type: 'signup', email }) } catch {}
    setResending(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!pwValid) return
    setLoading(true); setError('')
    try {
      if (mode === 'signup') {
        const { data, error: authErr } = await supabase.auth.signUp({ email, password })
        if (authErr) throw authErr
        if (data.user) {
          await supabase.from('users').upsert({ id: data.user.id, email: data.user.email, tier: 'free' }).then(() => {})
        }
        if (!data.session) { setEmailSent(true); setLoading(false); return }
        onSuccess(data.user, 'free')
      } else {
        const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
        if (authErr) throw authErr
        const { data: row } = await supabase.from('users').select('tier').eq('id', data.user.id).single()
        onSuccess(data.user, row?.tier || 'free')
      }
    } catch (err) {
      setError(friendlyAuthError(err.message))
    } finally { setLoading(false) }
  }

  const Brand = () => (
    <div className="auth-card__brand">
      <span className="auth-card__logo">🥗</span>
      <span className="auth-card__name">SMRT Meals</span>
    </div>
  )

  const Footer = () => (
    <p className="auth-card__footer">
      🔒 Secured by Supabase ·{' '}
      <a href="#" className="auth-footer-link">Privacy Policy</a>
      {' · '}
      <a href="#" className="auth-footer-link">Terms of Service</a>
    </p>
  )

  // ── Email verification screen ──
  if (emailSent === true) {
    return (
      <div className="modal-backdrop" onMouseDown={onClose}>
        <div className="auth-card" onMouseDown={e => e.stopPropagation()}>
          <Brand />
          <div className="auth-verify">
            <div className="auth-verify__icon">✉️</div>
            <h2 className="auth-verify__title">Check your email</h2>
            <p className="auth-verify__body">We sent a verification link to<br /><strong>{email}</strong></p>
            <p className="auth-verify__hint">Click the link to activate your account</p>
            <button className="auth-resend-btn" onClick={handleResend} disabled={resending}>
              {resending ? 'Sending…' : 'Resend email'}
            </button>
            <button className="auth-back-btn" onClick={() => { setEmailSent(false); switchMode('login') }}>
              ← Back to Sign In
            </button>
          </div>
          <Footer />
        </div>
      </div>
    )
  }

  // ── Password reset sent screen ──
  if (emailSent === 'forgot') {
    return (
      <div className="modal-backdrop" onMouseDown={onClose}>
        <div className="auth-card" onMouseDown={e => e.stopPropagation()}>
          <Brand />
          <div className="auth-verify">
            <div className="auth-verify__icon">📬</div>
            <h2 className="auth-verify__title">Reset link sent</h2>
            <p className="auth-verify__body">Check your inbox at<br /><strong>{email}</strong></p>
            <button className="auth-back-btn" onClick={() => { setEmailSent(false); setError('') }}>
              ← Back to Sign In
            </button>
          </div>
          <Footer />
        </div>
      </div>
    )
  }

  const pad = n => String(n).padStart(2, '0')

  // ── Main auth form ──
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="auth-card" onMouseDown={e => e.stopPropagation()}>
        <div className="auth-scarcity">
          <span className="auth-scarcity__badge">🔥 Founding Member Pricing</span>
          <p className="auth-scarcity__text">Lock in $9.99/month before we raise prices on June 30th</p>
          <div className="auth-countdown">
            <div className="countdown-unit">
              <span className="countdown-unit__num">{pad(countdown.days)}</span>
              <span className="countdown-unit__label">days</span>
            </div>
            <span className="countdown-sep">:</span>
            <div className="countdown-unit">
              <span className="countdown-unit__num">{pad(countdown.hours)}</span>
              <span className="countdown-unit__label">hrs</span>
            </div>
            <span className="countdown-sep">:</span>
            <div className="countdown-unit">
              <span className="countdown-unit__num">{pad(countdown.mins)}</span>
              <span className="countdown-unit__label">min</span>
            </div>
            <span className="countdown-sep">:</span>
            <div className="countdown-unit">
              <span className="countdown-unit__num">{pad(countdown.secs)}</span>
              <span className="countdown-unit__label">sec</span>
            </div>
          </div>
        </div>

        <Brand />
        <h2 className="auth-card__heading">{mode === 'login' ? 'Sign In' : 'Create Account'}</h2>

        {prompt && <p className="auth-gate-banner">{prompt}</p>}

        <div className="auth-testimonial" key={testimonialIdx}>
          <div className="auth-testimonial__stars">⭐⭐⭐⭐⭐</div>
          <p className="auth-testimonial__text">"{TESTIMONIALS[testimonialIdx].text}"</p>
          <div className="auth-testimonial__author">
            — {TESTIMONIALS[testimonialIdx].author}
            <span className="auth-testimonial__verified">✓ verified</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="auth-email">Email</label>
            <input className="auth-field__input" id="auth-email" type="email"
              placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>

          <div className="auth-field">
            <div className="auth-field__label-row">
              <label className="auth-field__label" htmlFor="auth-password">Password</label>
              {mode === 'login' && (
                <button type="button" className="auth-forgot" onClick={handleForgotPassword} disabled={loading}>
                  Forgot password?
                </button>
              )}
            </div>
            <div className="auth-pw-wrap">
              <input className="auth-field__input" id="auth-password"
                type={showPw ? 'text' : 'password'}
                placeholder={mode === 'signup' ? 'Create a strong password' : '••••••••'}
                value={password} onChange={e => setPassword(e.target.value)} required />
              <button type="button" className="auth-pw-eye"
                onClick={() => setShowPw(v => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          {mode === 'signup' && password.length > 0 && (
            <ul className="pw-reqs">
              {pwReqs.map((r, i) => (
                <li key={i} className={`pw-req${r.met ? ' pw-req--met' : ''}`}>
                  <span className="pw-req__icon">{r.met ? '✓' : '○'}</span>
                  {r.label}
                </li>
              ))}
            </ul>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-primary-btn" disabled={loading || !pwValid}>
            {loading
              ? <><span className="spinner" aria-hidden="true" /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
              : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

          {mode === 'signup' && (
            <p className="auth-trust-line">🔒 Your data is encrypted and never sold to third parties</p>
          )}
        </form>

        <div className="auth-divider"><span>or</span></div>

        <button type="button" className="auth-google-btn"
          onClick={handleGoogleSignIn} disabled={googleLoading || loading}>
          {googleLoading
            ? <span className="spinner" style={{ borderTopColor: '#4285F4', borderColor: 'rgba(66,133,244,0.3)' }} aria-hidden="true" />
            : (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )
          }
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <p className="auth-switch">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" className="auth-switch__btn"
            onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Sign up free' : 'Sign in'}
          </button>
        </p>

        <Footer />
      </div>
    </div>
  )
}

// ── LandingPage ───────────────────────────────────────────────────────────────
function LandingPage({ onEnter }) {
  return (
    <div className="landing">
      <div className="landing__content">
        <div className="landing__logo">🥗</div>
        <h1 className="landing__name">SMRT Meals</h1>
        <p className="landing__tagline">
          Eat smart. Spend smart. Live smart.
        </p>
        <button className="landing__cta" onClick={onEnter}>
          Try it free →
        </button>
      </div>
    </div>
  )
}

// ── ProfileDropdown ───────────────────────────────────────────────────────────
function ProfileDropdown({ user, userTier, profile, onClose, onSettings, onLogout, onUpgrade }) {
  const ref = useRef(null)
  const displayName = getDisplayName(user, profile)
  const initial = displayName.charAt(0).toUpperCase()
  const color = avatarColor(user.email || displayName)

  useEffect(() => {
    function onOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [onClose])

  return (
    <div ref={ref} className="profile-dropdown">
      <div className="profile-dropdown__user">
        <div className="profile-dropdown__avatar" style={{ background: color }}>{initial}</div>
        <div className="profile-dropdown__user-info">
          <p className="profile-dropdown__display">{displayName}</p>
          <p className="profile-dropdown__email">
            {user.email}
            <span className="profile-dropdown__verified" title="Verified">✓</span>
          </p>
        </div>
      </div>

      <div className="profile-dropdown__plan-row">
        <span className={`plan-badge plan-badge--${userTier === 'pro' ? 'pro' : 'free'}`}>
          {userTier === 'pro' ? '⭐ Pro' : '✦ Free'}
        </span>
        <span className="profile-dropdown__version">v1.0</span>
      </div>

      {userTier !== 'pro' && (
        <button className="profile-dropdown__upgrade" onClick={onUpgrade}>
          ⭐ Upgrade to Pro
        </button>
      )}

      <div className="profile-dropdown__sep" />

      <button className="profile-dropdown__item" onClick={onSettings}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        Account Settings
      </button>

      <div className="profile-dropdown__sep" />

      <button className="profile-dropdown__item profile-dropdown__item--signout" onClick={onLogout}>
        Sign Out
      </button>
    </div>
  )
}

// ── ProfilePanel ──────────────────────────────────────────────────────────────
function ProfilePanel({ profile, onSave, onClose }) {
  const [draft, setDraft] = useState(profile)
  function handleSave() {
    localStorage.setItem('mealPrepProfile', JSON.stringify(draft))
    onSave(draft); onClose()
  }
  return (
    <div className="profile-panel">
      <div className="profile-panel__header">
        <h3 className="profile-panel__title">Your Profile</h3>
        <button className="profile-close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="profile-panel__desc">Save your preferences so you don't have to retype every time.</p>
      <div className="form-group">
        <label htmlFor="prof-name"><span className="label-icon">👤</span> Your Name</label>
        <input id="prof-name" type="text" placeholder="e.g. Alex"
          value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <div className="form-group">
        <label htmlFor="prof-restrictions"><span className="label-icon">🚫</span> Dietary Restrictions</label>
        <input id="prof-restrictions" type="text" placeholder="e.g. gluten-free, dairy-free, nut allergy"
          value={draft.restrictions} onChange={e => setDraft({ ...draft, restrictions: e.target.value })} />
      </div>
      <div className="form-group">
        <label htmlFor="prof-cuisines"><span className="label-icon">🌍</span> Favorite Cuisines</label>
        <input id="prof-cuisines" type="text" placeholder="e.g. Mediterranean, Asian, Mexican"
          value={draft.cuisines} onChange={e => setDraft({ ...draft, cuisines: e.target.value })} />
      </div>
      <button className="save-profile-btn" onClick={handleSave}>Save Profile</button>
    </div>
  )
}

// ── RecipeModal ───────────────────────────────────────────────────────────────
function RecipeModal({ recipe, onClose }) {
  const parsed = recipe.content ? parseRecipe(recipe.content) : null
  const googleUrl  = `https://www.google.com/search?q=recipe+for+${encodeURIComponent(recipe.mealName)}`
  const youtubeUrl = `https://www.youtube.com/results?search_query=how+to+make+${encodeURIComponent(recipe.mealName)}`

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Recipe</span>
            <h2 className="modal__title">{recipe.mealName}</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close recipe">✕</button>
        </div>

        <div className="modal__body">
          {recipe.loading ? (
            <div className="modal__loading">
              <span className="spinner" aria-hidden="true" />
              Generating recipe…
            </div>
          ) : recipe.error ? (
            <p className="error-banner">{recipe.error}</p>
          ) : parsed ? (
            <>
              {(parsed.prepTime || parsed.cookTime || parsed.servings) && (
                <div className="modal__meta">
                  {parsed.prepTime && (
                    <div className="modal__meta-item">
                      <span className="modal__meta-label">⏱ Prep</span>
                      <span className="modal__meta-value">{parsed.prepTime}</span>
                    </div>
                  )}
                  {parsed.cookTime && (
                    <div className="modal__meta-item">
                      <span className="modal__meta-label">🔥 Cook</span>
                      <span className="modal__meta-value">{parsed.cookTime}</span>
                    </div>
                  )}
                  {parsed.servings && (
                    <div className="modal__meta-item">
                      <span className="modal__meta-label">🍽 Serves</span>
                      <span className="modal__meta-value">{parsed.servings}</span>
                    </div>
                  )}
                </div>
              )}

              {parsed.instructions.length > 0 && (
                <div>
                  <h3 className="modal__section-title">Instructions</h3>
                  <ol className="modal__instruction-list">
                    {parsed.instructions.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="modal__links">
                <a href={googleUrl} target="_blank" rel="noopener noreferrer"
                  className="modal-link modal-link--google">🔍 Find on Google</a>
                <a href={youtubeUrl} target="_blank" rel="noopener noreferrer"
                  className="modal-link modal-link--youtube">▶ Find on YouTube</a>
              </div>

            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ── MealSection (one meal row inside a card) ──────────────────────────────────
function MealSection({ type, name, day, onGetRecipe, onSwap, anySwapping, isOpen, onToggle, userTier, onProAction }) {
  const { icon, label } = MEAL_META[type]
  const hasName = Boolean(name)
  const isPro   = userTier === 'pro'
  const googleUrl  = `https://www.google.com/search?q=recipe+for+${encodeURIComponent(name || '')}`
  const youtubeUrl = `https://www.youtube.com/results?search_query=how+to+make+${encodeURIComponent(name || '')}`

  return (
    <div className={`meal-section meal-section--${type}`}>
      <div className="meal-section__type">
        <span className="meal-section__icon">{icon}</span>
        <span className="meal-section__label">{label}</span>
      </div>
      <p className="meal-section__name">{name || '—'}</p>
      {hasName && (
        <div className="meal-section__actions">
          {isPro ? (
            <button className="recipe-btn" onClick={() => onGetRecipe(name)}>
              📋 Get Recipe
            </button>
          ) : (
            <button className="recipe-btn recipe-btn--locked" onClick={onProAction}>
              🔒 Get Recipe · Pro
            </button>
          )}
          <div className="meal-dropdown">
            <button
              className="meal-menu-btn"
              onClick={e => { e.stopPropagation(); onToggle() }}
              aria-label="More options"
              aria-expanded={isOpen}
            >
              ···
            </button>
            {isOpen && (
              <div className="meal-dropdown__menu">
                {isPro ? (
                  <button className="dropdown-item" onClick={() => { onGetRecipe(name); onToggle() }}>
                    📋 Get Recipe
                  </button>
                ) : (
                  <button className="dropdown-item dropdown-item--locked" onClick={() => { onProAction(); onToggle() }}>
                    🔒 Get Recipe · Pro
                  </button>
                )}
                <a className="dropdown-item" href={googleUrl}
                  target="_blank" rel="noopener noreferrer" onClick={onToggle}>
                  🔍 Find on Google
                </a>
                <a className="dropdown-item" href={youtubeUrl}
                  target="_blank" rel="noopener noreferrer" onClick={onToggle}>
                  ▶ Find on YouTube
                </a>
                {isPro ? (
                  <button
                    className="dropdown-item dropdown-item--swap"
                    onClick={() => { onSwap(day); onToggle() }}
                    disabled={anySwapping}
                  >
                    ⇄ Swap this day
                  </button>
                ) : (
                  <button
                    className="dropdown-item dropdown-item--swap dropdown-item--locked"
                    onClick={() => { onProAction(); onToggle() }}
                  >
                    🔒 Swap this day · Pro
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── MealCard ──────────────────────────────────────────────────────────────────
function MealCard({ day, content, isLoading, isSwapping, isSwapped, anySwapping, swapKey, onSwap, onUndo, onGetRecipe, meals = ['breakfast', 'lunch', 'dinner'], userTier, onProAction }) {
  const [openDropdown, setOpenDropdown] = useState(null)
  const cardRef = useRef(null)
  const parsedMeals = parseMealContent(content || '')
  const showSkeleton = isSwapping || isLoading || !content

  useEffect(() => {
    if (!openDropdown) return
    function onOutside(e) {
      if (cardRef.current && !cardRef.current.contains(e.target)) setOpenDropdown(null)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [openDropdown])

  return (
    <div
      ref={cardRef}
      className={`meal-card${isLoading ? ' meal-card--loading' : ''}${isSwapping ? ' meal-card--swapping' : ''}${isSwapped && !isSwapping ? ' meal-card--swapped' : ''}`}
    >
      <div className="meal-card__header">
        <div className="meal-card__header-left">
          <span className="day-name">{day}</span>
          {isSwapped && !isSwapping && <span className="swapped-badge">swapped</span>}
        </div>
        <div className="meal-card__header-right">
          {isSwapped && !isSwapping && (
            <button className="undo-btn" onClick={() => onUndo(day)}>↩ undo</button>
          )}
          {content && !isLoading && (
            userTier === 'pro' ? (
              <button
                className={`swap-btn${isSwapping ? ' swap-btn--spinning' : ''}`}
                onClick={() => onSwap(day)}
                disabled={anySwapping}
                title="Swap this day's meals"
              >
                {isSwapping ? <span className="swap-spinner" aria-hidden="true" /> : '⇄'}
              </button>
            ) : (
              <button
                className="swap-btn swap-btn--locked"
                onClick={onProAction}
                title="Upgrade to Pro to swap meals"
              >
                🔒
              </button>
            )
          )}
        </div>
      </div>

      <div className="meal-card__body">
        {showSkeleton ? (
          <div className="skeleton">
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--short" />
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--short" />
            <div className="skeleton__line" />
            <div className="skeleton__line skeleton__line--xs" />
          </div>
        ) : (
          <div key={swapKey} className={`meal-sections${isSwapped ? ' meal-sections--new' : ''}`}>
            {meals.map(type => (
              <MealSection
                key={type}
                type={type}
                name={parsedMeals[type]}
                day={day}
                onGetRecipe={onGetRecipe}
                onSwap={onSwap}
                anySwapping={anySwapping}
                isOpen={openDropdown === type}
                onToggle={() => setOpenDropdown(prev => prev === type ? null : type)}
                userTier={userTier}
                onProAction={onProAction}
              />
            ))}
            {parsedMeals.cost && <div className="meal-cost">{parsedMeals.cost}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── GrocerySection ────────────────────────────────────────────────────────────
function GrocerySection({ activeDays, groceryByDay, groceryList, pantryItems, newIngredients, userTier, onProAction }) {
  const [checked, setChecked] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('smrtmeals_grocery_checked') || '[]')) }
    catch { return new Set() }
  })

  useEffect(() => {
    localStorage.setItem('smrtmeals_grocery_checked', JSON.stringify([...checked]))
  }, [checked])

  if (!groceryList.length) return null

  const total = groceryList.length
  const checkedCount = groceryList.filter(i => checked.has(i.toLowerCase())).length
  const pct = total > 0 ? (checkedCount / total) * 100 : 0

  function toggle(item) {
    setChecked(prev => {
      const next = new Set(prev)
      const k = item.toLowerCase()
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  function inPantry(item) {
    const lower = item.toLowerCase()
    return pantryItems.some(p => {
      const pl = p.toLowerCase().trim()
      return pl.length > 2 && (lower === pl || lower.includes(pl) || pl.includes(lower))
    })
  }

  const isPro = userTier === 'pro'
  const FREE_UNLOCKED = DAYS.slice(0, 3) // Monday, Tuesday, Wednesday

  function renderChip(item, i) {
    const isChecked = checked.has(item.toLowerCase())
    const pantry    = inPantry(item)
    const isNew     = newIngredients.has(item.toLowerCase())
    const search    = cleanIngredient(item)
    return (
      <label key={i} className={[
        'grocery-chip',
        isChecked ? 'grocery-chip--checked' : '',
        pantry    ? 'grocery-chip--pantry'  : '',
        isNew     ? 'grocery-chip--new'     : '',
      ].filter(Boolean).join(' ')}>
        <input type="checkbox" className="grocery-chip__cb"
          checked={isChecked} onChange={() => toggle(item)} />
        <span className="grocery-chip__name">{item}</span>
        {pantry && <span className="grocery-chip__owned" title="In your pantry">✓</span>}
        {isPro && (
          <span className="grocery-chip__links">
            <a href={walmartUrl(search)} target="_blank" rel="noopener noreferrer"
              className="chip-shop-btn" title="Find on Walmart" aria-label="Find on Walmart"
              onClick={e => e.stopPropagation()}>
              {WalmartIcon}
            </a>
            <a href={amazonUrl(search)} target="_blank" rel="noopener noreferrer"
              className="chip-shop-btn" title="Find on Amazon" aria-label="Find on Amazon"
              onClick={e => e.stopPropagation()}>
              {AmazonIcon}
            </a>
          </span>
        )}
      </label>
    )
  }

  // Items added by meal-swaps may not belong to any day
  const allDayItems = new Set(Object.values(groceryByDay).flat().map(i => i.toLowerCase()))
  const extraItems  = groceryList.filter(i => !allDayItems.has(i.toLowerCase()))

  return (
    <section className="grocery-section">
      <div className="grocery-header">
        <h2 className="grocery-title">🛒 Grocery List</h2>
      </div>

      <div className="grocery-progress">
        <div className="grocery-progress__bar">
          <div className="grocery-progress__fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="grocery-progress__label">
          {checkedCount} of {total} ingredient{total !== 1 ? 's' : ''} ordered
        </span>
      </div>

      <div className="grocery-controls">
        <button className="grocery-ctrl-btn"
          onClick={() => setChecked(new Set(groceryList.map(i => i.toLowerCase())))}
          disabled={checkedCount === total}>Check All</button>
        <button className="grocery-ctrl-btn" onClick={() => setChecked(new Set())}
          disabled={checkedCount === 0}>Uncheck All</button>
      </div>

      <div className="grocery-days">
        {activeDays.map(day => {
          const items = groceryByDay[day]
          const isLocked = !isPro && !FREE_UNLOCKED.includes(day)

          if (isLocked) {
            return (
              <div key={day} className="grocery-day grocery-day--locked">
                <span className="grocery-day__label">{day}</span>
                <div className="grocery-day-lock">
                  <span className="grocery-day-lock__text">
                    Upgrade to Pro for the full 5-day grocery list 🔒
                  </span>
                  <button className="grocery-day-lock__btn" onClick={onProAction}>
                    Upgrade →
                  </button>
                </div>
              </div>
            )
          }

          if (!items?.length) return null
          return (
            <div key={day} className="grocery-day">
              <span className="grocery-day__label">{day}</span>
              <div className="grocery-day__items">
                {items.map(renderChip)}
              </div>
            </div>
          )
        })}
        {extraItems.length > 0 && (
          <div className="grocery-day">
            <span className="grocery-day__label">Added</span>
            <div className="grocery-day__items">
              {extraItems.map(renderChip)}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [budget, setBudget] = useState('')
  const [goals, setGoals] = useState(() => {
    const p = loadProfile()
    return [p.restrictions, p.cuisines].filter(Boolean).join(', ')
  })
  const [pantryItems, setPantryItems] = useState([])
  const [addItemInput, setAddItemInput] = useState('')
  const [selectedPresets, setSelectedPresets] = useState(new Set())
  const [mealPlan, setMealPlan] = useState(null)
  const [groceryList, setGroceryList] = useState([])
  const [groceryByDay, setGroceryByDay] = useState({})
  const [loading, setLoading] = useState(false)
  const [activeDay, setActiveDay] = useState(-1)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(loadProfile)
  const [showProfile, setShowProfile] = useState(false)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)

  const fileInputRef = useRef(null)
  const [scanningPhoto, setScanningPhoto] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scannedCount, setScannedCount] = useState(0)

  const [swappingDay, setSwappingDay] = useState(null)
  const [swapHistory, setSwapHistory] = useState({})
  const [swappedDays, setSwappedDays] = useState(new Set())
  const [swapKeys, setSwapKeys] = useState({})
  const [newIngredients, setNewIngredients] = useState(new Set())

  const [recipe, setRecipe] = useState(null)

  const [showLanding, setShowLanding] = useState(true)
  const [retryStatus, setRetryStatus] = useState('')

  const [step, setStep] = useState(1)
  const [animDir, setAnimDir] = useState(null)
  const [animKey, setAnimKey] = useState(0)

  // Step 4 pro options
  const [mealTypes, setMealTypes] = useState('all')
  const [customMeals, setCustomMeals] = useState(new Set(['breakfast', 'lunch', 'dinner']))
  const [planDays, setPlanDays] = useState(5)
  const [startDay, setStartDay] = useState('Monday')

  // Reflects what was actually generated (set at generate time)
  const [activeDays, setActiveDays] = useState(DAYS)
  const [activeMeals, setActiveMeals] = useState(['breakfast', 'lunch', 'dinner'])

  // Auth
  const [user, setUser] = useState(null)
  const [userTier, setUserTier] = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authPrompt, setAuthPrompt] = useState('')
  const [freeGenerationsUsed, setFreeGenerationsUsed] = useState(0)

  function handleProfileSave(saved) {
    setProfile(saved)
    const parts = [saved.restrictions, saved.cuisines].filter(Boolean)
    if (parts.length) setGoals(parts.join(', '))
  }

  // Restore session on mount and keep auth state in sync
  useEffect(() => {
    // Shared helper: set user state + ensure a users-table row exists (covers Google OAuth)
    async function applySession(authUser) {
      setUser(authUser)
      // Insert a row if one doesn't exist yet; ignoreDuplicates preserves existing tier
      await supabase.from('users').upsert(
        { id: authUser.id, email: authUser.email, tier: 'free' },
        { onConflict: 'id', ignoreDuplicates: true }
      ).then(() => {})
      const { data: row } = await supabase
        .from('users').select('tier').eq('id', authUser.id).single()
      setUserTier(row?.tier || 'free')
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) applySession(session.user)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session?.user) {
        setUser(null); setUserTier(null)
      } else if (event === 'SIGNED_IN') {
        applySession(session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  function handleAuthSuccess(authUser, tier) {
    setUser(authUser)
    setUserTier(tier || 'free')
    setShowAuthModal(false)
    setAuthPrompt('')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    localStorage.clear()

    // Reset every piece of app state so the next visitor starts fresh
    setUser(null)
    setUserTier(null)
    setFreeGenerationsUsed(0)
    setShowProfileDropdown(false)
    setShowProfile(false)
    setProfile(DEFAULT_PROFILE)
    setBudget('')
    setGoals('')
    setPantryItems([])
    setAddItemInput('')
    setSelectedPresets(new Set())
    setMealPlan(null)
    setGroceryList([])
    setGroceryByDay({})
    setNewIngredients(new Set())
    setSwapHistory({})
    setSwappedDays(new Set())
    setSwapKeys({})
    setSwappingDay(null)
    setRecipe(null)
    setError('')
    setRetryStatus('')
    setLoading(false)
    setActiveDay(-1)
    setScanningPhoto(false)
    setScanError('')
    setScannedCount(0)

    setStep(1)
    setAnimDir(null)
    setAnimKey(0)
    setMealTypes('all')
    setCustomMeals(new Set(['breakfast', 'lunch', 'dinner']))
    setPlanDays(5)
    setStartDay('Monday')
    setActiveDays(DAYS)
    setActiveMeals(['breakfast', 'lunch', 'dinner'])

    // Return to the landing page
    setShowLanding(true)
  }

  async function handleUpgrade() {
    if (!user) return
    setShowProfileDropdown(false)
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, userId: user.id }),
      })
      const { url, error } = await res.json()
      if (error) throw new Error(error)
      window.location.href = url
    } catch (err) {
      console.error('Upgrade error:', err.message)
    }
  }

  function openAuthModal(mode, prompt = '') {
    setAuthMode(mode)
    setAuthPrompt(prompt)
    setShowAuthModal(true)
  }

  function handleProAction(msg) {
    if (user) handleUpgrade()
    else openAuthModal('signup', msg || 'Create a free account to get started, then upgrade to unlock Pro features.')
  }

  function goStep(n) {
    setError('')
    setAnimDir(n > step ? 'forward' : 'backward')
    setAnimKey(k => k + 1)
    setStep(n)
  }

  function handlePresetToggle(preset) {
    setSelectedPresets(prev => {
      const next = new Set(prev)
      if (next.has(preset.id)) next.delete(preset.id)
      else next.add(preset.id)
      const labels = DIETARY_PRESETS.filter(p => next.has(p.id)).map(p => p.label)
      setGoals(labels.join(', '))
      return next
    })
  }

  function handleAddItem(e) {
    e.preventDefault()
    const item = addItemInput.trim().toLowerCase()
    if (!item) return
    setPantryItems(prev => prev.includes(item) ? prev : [...prev, item])
    setAddItemInput('')
  }

  function handleRemoveItem(idx) {
    setPantryItems(prev => prev.filter((_, i) => i !== idx))
  }

  async function handlePhotoScan(e) {
    if (userTier !== 'pro') {
      if (fileInputRef.current) fileInputRef.current.value = ''
      handleProAction('Pantry scanning is a Pro feature — upgrade to unlock instant ingredient detection from photos.')
      return
    }
    const files = Array.from(e.target.files)
    if (!files.length) return
    setScanningPhoto(true); setScanError('')
    const identified = new Set(pantryItems.map(s => s.toLowerCase()))
    for (const file of files) {
      try {
        const base64 = await resizeImage(file)
        const response = await withRetry(() => client.messages.create({
          model: 'claude-opus-4-7', max_tokens: 512,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: 'Look at this photo of a pantry, fridge, or kitchen. List every visible food ingredient or grocery item you can identify. Return ONLY a comma-separated list of ingredient names (e.g. "eggs, milk, cheddar cheese, olive oil, chicken breast"). No explanations, no amounts, just the names.' },
          ]}],
        }))
        const text = response.content.find(c => c.type === 'text')?.text ?? ''
        text.split(',').forEach(raw => {
          const item = raw.trim().replace(/[.!?]$/, '').toLowerCase()
          if (item.length > 2) identified.add(item)
        })
        setScannedCount(n => n + 1)
      } catch (err) { setScanError(`Scan failed: ${err.message}`) }
    }
    setPantryItems(Array.from(identified).filter(Boolean))
    setScanningPhoto(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSwap(day) {
    if (userTier !== 'pro') { handleProAction(); return }
    if (swappingDay || !mealPlan?.[day]) return
    setSwappingDay(day)
    const prompt = `You are swapping one day's meals in a 5-day meal plan.

Day being swapped: ${day}
Current meals (replace these):
${mealPlan[day]}

Ingredients already in the grocery list (use these first):
${groceryList.length ? groceryList.join(', ') : 'None listed'}

User dietary goals: ${goals}

Provide a meaningfully different replacement. Favor existing grocery list ingredients.

Respond ONLY in this exact format:
Breakfast: [description]
Lunch: [description]
Dinner: [description]
• Estimated cost: $[amount]

NEW INGREDIENTS NEEDED:
• [simple ingredient name]
(Include only if 1–2 genuinely new items are required. Omit entirely otherwise.)`

    try {
      const response = await withRetry(() => client.messages.create({
        model: 'claude-opus-4-7', max_tokens: 768,
        messages: [{ role: 'user', content: prompt }],
      }))
      const text = response.content.find(c => c.type === 'text')?.text?.trim() ?? ''
      const marker = 'NEW INGREDIENTS NEEDED:'
      const hasNew = text.includes(marker)
      const mealText = hasNew ? text.slice(0, text.indexOf(marker)).trim() : text
      if (hasNew) {
        const additions = text.slice(text.indexOf(marker) + marker.length).split('\n')
          .filter(l => /^[•\-\*]/.test(l.trim()))
          .map(l => l.replace(/^[•\-\*]\s*/, '').trim().toLowerCase()).filter(Boolean)
        if (additions.length) {
          setNewIngredients(prev => new Set([...prev, ...additions]))
          setGroceryList(prev => {
            const existing = new Set(prev.map(i => i.toLowerCase()))
            const toAdd = additions.filter(i => !existing.has(i))
            return toAdd.length ? [...prev, ...toAdd] : prev
          })
        }
      }
      const key = Date.now()
      setSwapHistory(prev => ({ ...prev, [day]: { original: mealPlan[day] } }))
      setMealPlan(prev => ({ ...prev, [day]: mealText }))
      setSwappedDays(prev => new Set([...prev, day]))
      setSwapKeys(prev => ({ ...prev, [day]: key }))
    } catch { /* falls back gracefully */ } finally { setSwappingDay(null) }
  }

  function handleUndo(day) {
    if (!swapHistory[day]) return
    setMealPlan(prev => ({ ...prev, [day]: swapHistory[day].original }))
    setSwapHistory(prev => { const n = { ...prev }; delete n[day]; return n })
    setSwappedDays(prev => { const n = new Set(prev); n.delete(day); return n })
    setSwapKeys(prev => ({ ...prev, [day]: 0 }))
  }

  async function handleGetRecipe(mealName) {
    setRecipe({ mealName, loading: true, content: '' })
    const pantryText = pantryItems.join(', ')
    const prompt = `Generate a complete recipe for "${mealName}".

${pantryText ? `User's pantry items available: ${pantryText}\nMark each pantry item used with ✓ at the end of its line in the ingredients.` : ''}
${goals ? `Dietary goals: ${goals}` : ''}

Respond in this EXACT format — no extra text before or after:

PREP TIME: [X minutes]
COOK TIME: [X minutes]
SERVINGS: [X servings]

INGREDIENTS:
• [quantity] [ingredient] ✓
• [quantity] [ingredient]

INSTRUCTIONS:
1. [step]
2. [step]
3. [step]

Mark pantry items with ✓. Keep instructions clear and practical.`

    try {
      const response = await withRetry(() => client.messages.create({
        model: 'claude-opus-4-7', max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }))
      const content = response.content.find(c => c.type === 'text')?.text ?? ''
      setRecipe({ mealName, loading: false, content })
    } catch (err) {
      setRecipe({ mealName, loading: false, content: '', error: err.message })
    }
  }

  async function handleGenerate() {
    if (!budget.trim()) {
      setError('Please enter your weekly budget.')
      return
    }
    if (!user && freeGenerationsUsed >= 1) {
      openAuthModal('signup', "You've used your free plan. Sign up — it's free — to generate unlimited meal plans.")
      return
    }
    setError(''); setRetryStatus(''); setLoading(true); setMealPlan(null); setGroceryList([]); setGroceryByDay({})
    setActiveDay(0); setSwapHistory({}); setSwappedDays(new Set())
    setSwapKeys({}); setNewIngredients(new Set()); setRecipe(null)
    let succeeded = false

    // promptDays: what Claude actually generates (free = Mon/Tue/Wed only, pro = custom)
    // displayDays: what renders in the grid (free = all 5 so Thu/Fri lock teaser shows, pro = same as prompt)
    const isPro        = userTier === 'pro'
    const promptDays   = isPro ? getActiveDays(planDays, startDay) : DAYS.slice(0, 3)
    const displayDays  = isPro ? promptDays : DAYS
    const promptMeals  = isPro ? getMealsList(mealTypes, customMeals) : ['breakfast', 'lunch', 'dinner']
    setActiveDays(displayDays)
    setActiveMeals(promptMeals)

    const forName = profile.name ? `for ${profile.name} ` : ''

    function buildDaySection(day) {
      const mealLines = []
      if (promptMeals.includes('breakfast')) mealLines.push('Breakfast: [brief meal description]')
      if (promptMeals.includes('lunch'))     mealLines.push('Lunch: [brief meal description]')
      if (promptMeals.includes('dinner'))    mealLines.push('Dinner: [brief meal description]')
      return `**${day.toUpperCase()}**\n${mealLines.join('\n')}\n• Estimated cost: $[amount]`
    }

    const groceryDaySections = promptDays.map(d => `${d.toUpperCase()}\n• [ingredient]\n• [ingredient]`).join('\n\n')

    const prompt = `You are a professional nutritionist. Create a practical ${promptDays.length}-day meal plan (${promptDays[0]}–${promptDays[promptDays.length - 1]}) ${forName}for:

Weekly Budget: $${budget}
Dietary Goals: ${goals || 'balanced, healthy eating'}
Pantry Items: ${pantryItems.length ? pantryItems.join(', ') : 'None specified'}

Respond ONLY in this exact format — no intro or outro:

${promptDays.map(buildDaySection).join('\n\n')}

**GROCERY LIST**
${groceryDaySections}

(List ingredients needed for each specific day. Simple grocery names only — no amounts, no prep notes, no duplicates within a day.)

Keep meals practical, budget-friendly, and aligned with the dietary goals. Use pantry items where possible.`

    try {
      await withRetry(
        async () => {
          let fullText = ''
          const plan = Object.fromEntries(promptDays.map(d => [d, '']))
          const stream = await client.messages.stream({
            model: 'claude-opus-4-7', max_tokens: 4096,
            thinking: { type: 'adaptive' },
            messages: [{ role: 'user', content: prompt }],
          })
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              fullText += chunk.delta.text
              for (let i = 0; i < promptDays.length; i++) {
                const day = promptDays[i]
                const marker = `**${day.toUpperCase()}**`
                const start = fullText.indexOf(marker)
                if (start === -1) continue
                const nextMarker = promptDays[i + 1] ? `**${promptDays[i + 1].toUpperCase()}**` : '**GROCERY LIST**'
                const end = fullText.indexOf(nextMarker, start + marker.length)
                plan[day] = fullText.slice(start + marker.length, end === -1 ? fullText.length : end).trim()
                setActiveDay(i)
              }
              setMealPlan({ ...plan })
              const gMarker = '**GROCERY LIST**'
              const gStart = fullText.indexOf(gMarker)
              if (gStart !== -1) {
                const gSection = fullText.slice(gStart + gMarker.length).trim()
                const byDay = {}
                const allItems = []
                let currentDay = null
                for (const rawLine of gSection.split('\n')) {
                  const line = rawLine.trim()
                  if (!line || line.startsWith('(')) continue
                  const matchedDay = promptDays.find(d => line.toUpperCase() === d.toUpperCase())
                  if (matchedDay) {
                    currentDay = matchedDay
                    if (!byDay[matchedDay]) byDay[matchedDay] = []
                  } else if (/^[•\-\*]/.test(line) && currentDay) {
                    const item = line.replace(/^[•\-\*]\s*/, '').trim()
                    if (item && !byDay[currentDay].includes(item)) {
                      byDay[currentDay].push(item)
                      if (!allItems.includes(item)) allItems.push(item)
                    }
                  }
                }
                setGroceryByDay({ ...byDay })
                setGroceryList(allItems)
              }
            }
          }
          setActiveDay(-1)
        },
        {
          retries: 3,
          delayMs: 3000,
          onRetry: (attempt) => {
            setRetryStatus(`High demand right now, retrying… (${attempt}/3)`)
            setMealPlan(null)
            setGroceryList([])
            setActiveDay(0)
          },
        }
      )
      succeeded = true
      if (!user) setFreeGenerationsUsed(n => n + 1)
    } catch (err) {
      const msg = err?.message ?? String(err)
      if (isOverloaded(err)) {
        setError('Our AI is experiencing high demand right now. Please try again in a minute.')
      } else {
        setError(msg.includes('401') || msg.toLowerCase().includes('api key')
          ? 'Invalid API key — check VITE_ANTHROPIC_KEY in your .env file.'
          : `Error: ${msg}`)
      }
    } finally {
      setRetryStatus('')
      setLoading(false)
    }
  }

  const hasResults = mealPlan && Object.values(mealPlan).some(Boolean)

  if (showLanding) return <LandingPage onEnter={() => setShowLanding(false)} />

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__top">
          <div className="app-header__brand">
            <div className="app-header__icon">🥗</div>
            <div>
              <h1 className="app-header__title">SMRT Meals</h1>
              <p className="app-header__subtitle">Eat smart. Spend smart. Live smart.</p>
            </div>
          </div>
          <div className="app-header__right" style={{ position: 'relative' }}>
            {user ? (
              <>
                <button
                  className={`profile-toggle-btn${showProfileDropdown ? ' profile-toggle-btn--active' : ''}`}
                  onClick={() => setShowProfileDropdown(v => !v)}
                >
                  <span className="profile-btn__avatar"
                    style={{ background: avatarColor(user.email || '') }}>
                    {getDisplayName(user, profile).charAt(0).toUpperCase()}
                  </span>
                  {getFirstName(getDisplayName(user, profile))}
                </button>
                {showProfileDropdown && (
                  <ProfileDropdown
                    user={user}
                    userTier={userTier}
                    profile={profile}
                    onClose={() => setShowProfileDropdown(false)}
                    onSettings={() => { setShowProfileDropdown(false); setShowProfile(true) }}
                    onLogout={handleLogout}
                    onUpgrade={handleUpgrade}
                  />
                )}
              </>
            ) : (
              <button className="header-auth__signin" onClick={() => openAuthModal('login')}>
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {showProfile && (
          <ProfilePanel profile={profile} onSave={handleProfileSave} onClose={() => setShowProfile(false)} />
        )}

        <section className="form-section">
          <div className="step-flow">

            {step === 1 && (
              <div className={`step-card${animDir ? ` step-card--${animDir}` : ''}`} key={animKey}>
                <div className="step-progress">
                  <div className="step-track">
                    <div className="step-seg step-seg--active" />
                    <div className="step-seg" />
                    <div className="step-seg" />
                    <div className="step-seg" />
                  </div>
                  <span className="step-label">Step 1 of 4</span>
                </div>
                <h2 className="step-heading">What's your weekly budget?</h2>
                <p className="step-subheading">We'll build a meal plan that fits your spending.</p>
                <div className="step-budget-wrap">
                  <span className="step-budget-prefix">$</span>
                  <input
                    className="step-budget-input"
                    type="number" min="1" placeholder="75"
                    value={budget}
                    onChange={e => setBudget(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                </div>
                <div className="step-nav">
                  <button className="step-next-btn" onClick={() => goStep(2)} disabled={!budget.trim() || loading}>
                    Next →
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className={`step-card${animDir ? ` step-card--${animDir}` : ''}`} key={animKey}>
                <div className="step-progress">
                  <div className="step-track">
                    <div className="step-seg step-seg--done" />
                    <div className="step-seg step-seg--active" />
                    <div className="step-seg" />
                    <div className="step-seg" />
                  </div>
                  <span className="step-label">Step 2 of 4</span>
                </div>
                <h2 className="step-heading">What are your dietary goals?</h2>
                <p className="step-subheading">Pick any that apply, or describe your own below.</p>
                <div className="presets-grid">
                  {DIETARY_PRESETS.map(preset => (
                    <button key={preset.id} type="button"
                      className={`preset-card${selectedPresets.has(preset.id) ? ' preset-card--selected' : ''}`}
                      onClick={() => handlePresetToggle(preset)}
                      disabled={loading}
                    >
                      <span className="preset-card__icon">{preset.icon}</span>
                      <span className="preset-card__label">{preset.label}</span>
                    </button>
                  ))}
                </div>
                <input
                  className="step-goals-input"
                  type="text"
                  placeholder="Or describe your goals… e.g. high protein, low carb, gluten-free"
                  value={goals}
                  onChange={e => setGoals(e.target.value)}
                  disabled={loading}
                />
                <div className="step-nav">
                  <button className="step-back-btn" onClick={() => goStep(1)} disabled={loading}>← Back</button>
                  <button className="step-next-btn" onClick={() => goStep(3)} disabled={loading}>Next →</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className={`step-card${animDir ? ` step-card--${animDir}` : ''}`} key={animKey}>
                <div className="step-progress">
                  <div className="step-track">
                    <div className="step-seg step-seg--done" />
                    <div className="step-seg step-seg--done" />
                    <div className="step-seg step-seg--active" />
                    <div className="step-seg" />
                  </div>
                  <span className="step-label">Step 3 of 4</span>
                </div>
                <h2 className="step-heading">What's in your pantry?</h2>
                <p className="step-subheading">Optional — we'll work around what you already have.</p>

                {userTier === 'pro' ? (
                  <button type="button"
                    className={`scan-btn-full${scanningPhoto ? ' scan-btn-full--loading' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={scanningPhoto || loading}
                  >
                    {scanningPhoto
                      ? <><span className="scan-spinner" aria-hidden="true" /> Scanning photo…</>
                      : <><span className="scan-btn-full__icon">📷</span> Scan Your Pantry</>}
                  </button>
                ) : (
                  <button type="button"
                    className="scan-btn-full scan-btn-full--locked"
                    onClick={() => handleProAction('Pantry scanning is a Pro feature — upgrade to unlock instant ingredient detection from photos.')}
                    disabled={loading}
                  >
                    <span className="scan-btn-full__icon">🔒</span> Scan Your Pantry · Pro
                  </button>
                )}

                {scanError && <p className="scan-error">{scanError}</p>}

                <div className="step-or-divider">or type your ingredients</div>

                {pantryItems.length > 0 && (
                  <ul className="pantry-list">
                    {pantryItems.map((item, i) => (
                      <li key={i} className="pantry-item">
                        <span className="pantry-item__check">✓</span>
                        <span className="pantry-item__name">{item}</span>
                        <button type="button" className="pantry-item__remove"
                          onClick={() => handleRemoveItem(i)} aria-label={`Remove ${item}`}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}

                <form className="pantry-add-row" onSubmit={handleAddItem}>
                  <input type="text" className="pantry-add-input"
                    placeholder="Add an ingredient…"
                    value={addItemInput}
                    onChange={e => setAddItemInput(e.target.value)}
                    disabled={loading} />
                  <button type="submit" className="pantry-add-btn"
                    disabled={!addItemInput.trim() || loading}>+</button>
                </form>

                <input ref={fileInputRef} type="file" accept="image/*" multiple
                  style={{ display: 'none' }} onChange={handlePhotoScan} />

                {error && <p className="error-banner">{error}</p>}

                <div className="step-nav">
                  <button className="step-back-btn" onClick={() => goStep(2)} disabled={loading}>← Back</button>
                  <button className="step-next-btn" onClick={() => goStep(4)} disabled={loading}>Next →</button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className={`step-card${animDir ? ` step-card--${animDir}` : ''}`} key={animKey}>
                <div className="step-progress">
                  <div className="step-track">
                    <div className="step-seg step-seg--done" />
                    <div className="step-seg step-seg--done" />
                    <div className="step-seg step-seg--done" />
                    <div className="step-seg step-seg--active" />
                  </div>
                  <span className="step-label">Step 4 of 4</span>
                </div>
                <h2 className="step-heading">Customize your plan</h2>
                <p className="step-subheading">Fine-tune which meals and days to include.</p>

                <div className={`step4-options${userTier !== 'pro' ? ' step4-options--locked' : ''}`}>
                  {userTier !== 'pro' && (
                    <div className="step4-lock-overlay">
                      <span className="step4-lock-icon">🔒</span>
                      <p className="step4-lock-msg">Pro feature — Upgrade to unlock full plan customization</p>
                      <button className="step4-lock-btn"
                        onClick={() => user ? handleUpgrade() : openAuthModal('signup', 'Create a free account, then upgrade to Pro for full plan customization.')}>
                        Upgrade to Pro →
                      </button>
                    </div>
                  )}

                  <div className="step4-body">
                    <div className="step-option-group">
                      <p className="step-option-label">Which meals?</p>
                      <div className="option-grid">
                        {[
                          { id: 'all',       label: 'All meals'  },
                          { id: 'breakfast', label: 'Breakfast'  },
                          { id: 'lunch',     label: 'Lunch'      },
                          { id: 'dinner',    label: 'Dinner'     },
                          { id: 'custom',    label: 'Custom'     },
                        ].map(opt => (
                          <button key={opt.id}
                            className={`option-pill${mealTypes === opt.id ? ' option-pill--selected' : ''}`}
                            onClick={() => setMealTypes(opt.id)}
                            disabled={userTier !== 'pro'}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {mealTypes === 'custom' && (
                        <div className="custom-meals-row">
                          {['breakfast', 'lunch', 'dinner'].map(meal => (
                            <label key={meal} className={`custom-meal-check${customMeals.has(meal) ? ' custom-meal-check--on' : ''}`}>
                              <input type="checkbox"
                                checked={customMeals.has(meal)}
                                onChange={() => setCustomMeals(prev => {
                                  const next = new Set(prev)
                                  if (next.has(meal)) { if (next.size > 1) next.delete(meal) }
                                  else next.add(meal)
                                  return next
                                })}
                                disabled={userTier !== 'pro'}
                              />
                              {meal.charAt(0).toUpperCase() + meal.slice(1)}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="step-option-group">
                      <p className="step-option-label">How many days?</p>
                      <div className="option-grid option-grid--days">
                        {[3, 5, 7].map(n => (
                          <button key={n}
                            className={`option-pill${planDays === n ? ' option-pill--selected' : ''}`}
                            onClick={() => setPlanDays(n)}
                            disabled={userTier !== 'pro'}
                          >
                            {n} days
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="step-option-group">
                      <p className="step-option-label">Starting day?</p>
                      <div className="option-grid option-grid--week">
                        {ALL_WEEK_DAYS.map(day => (
                          <button key={day}
                            className={`option-pill option-pill--sm${startDay === day ? ' option-pill--selected' : ''}`}
                            onClick={() => setStartDay(day)}
                            disabled={userTier !== 'pro'}
                          >
                            {day.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {error && <p className="error-banner" style={{ marginTop: 16 }}>{error}</p>}

                <div className="step-nav">
                  <button className="step-back-btn" onClick={() => goStep(3)} disabled={loading}>← Back</button>
                  <button className="step-next-btn" onClick={handleGenerate} disabled={loading}>
                    {loading
                      ? <><span className="spinner" aria-hidden="true" /> {retryStatus || 'Generating…'}</>
                      : '✨ Generate My Plan'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </section>

        {(hasResults || loading) && (
          <section className="results-section">
            <h2 className="results-title">Your {activeDays.length}-Day Meal Plan</h2>
            <div className="cards-grid">
              {activeDays.map((day, i) => {
                const isLocked = userTier !== 'pro' && !DAYS.slice(0, 3).includes(day)
                return (
                  <div key={day} className={`day-wrapper${isLocked ? ' day-wrapper--locked' : ''}`}>
                    <MealCard
                      day={day}
                      content={mealPlan?.[day] || undefined}
                      isLoading={loading && i <= activeDay && !mealPlan?.[day]}
                      isSwapping={swappingDay === day}
                      isSwapped={swappedDays.has(day)}
                      anySwapping={!!swappingDay}
                      swapKey={swapKeys[day] ?? 0}
                      onSwap={handleSwap}
                      onUndo={handleUndo}
                      onGetRecipe={handleGetRecipe}
                      meals={activeMeals}
                      userTier={userTier}
                      onProAction={handleProAction}
                    />
                    {isLocked && (
                      <div className="day-lock-overlay">
                        <span className="day-lock-overlay__icon">🔒</span>
                        <p className="day-lock-overlay__msg">Upgrade to Pro for the full 5-day plan</p>
                        <button
                          className="day-lock-overlay__btn"
                          onClick={() => user ? handleUpgrade() : openAuthModal('signup', 'Create a free account to unlock the full 5-day meal plan.')}
                        >
                          Upgrade to Pro
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {!loading && groceryList.length > 0 && (
          <GrocerySection
            activeDays={activeDays}
            groceryByDay={groceryByDay}
            groceryList={groceryList}
            pantryItems={pantryItems}
            newIngredients={newIngredients}
            userTier={userTier}
            onProAction={handleProAction}
          />
        )}
      </main>

      {recipe && <RecipeModal recipe={recipe} onClose={() => setRecipe(null)} />}
      {showAuthModal && (
        <AuthModal
          initialMode={authMode}
          prompt={authPrompt}
          onClose={() => { setShowAuthModal(false); setAuthPrompt('') }}
          onSuccess={handleAuthSuccess}
        />
      )}
    </div>
  )
}
