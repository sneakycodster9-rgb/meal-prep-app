import { useState, useRef, useEffect } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase.js'
import './App.css'

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_KEY,
  dangerouslyAllowBrowser: true,
})

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const DEFAULT_PROFILE = { name: '', restrictions: '', cuisines: '' }

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
  'Password should be at least 6 characters':    'Password must be at least 6 characters.',
  'Email not confirmed':                         'Check your inbox to confirm your email, then sign in.',
  'Unable to validate email address':            'Please enter a valid email address.',
}

function friendlyAuthError(msg) {
  for (const [key, friendly] of Object.entries(AUTH_ERROR_MAP)) {
    if (msg.includes(key)) return friendly
  }
  return msg
}

// ── AuthModal ─────────────────────────────────────────────────────────────────
function AuthModal({ initialMode = 'login', prompt = '', onClose, onSuccess }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function switchMode(next) {
    setMode(next)
    setError('')
    setNotice('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'signup') {
        const { data, error: authErr } = await supabase.auth.signUp({ email, password })
        if (authErr) throw authErr
        // create user record; ignore errors (table may have RLS or not exist yet)
        if (data.user) {
          await supabase.from('users').upsert({
            id: data.user.id,
            email: data.user.email,
            tier: 'free',
          }).then(() => {}) // fire-and-forget
        }
        // if email confirmation is required the session is null
        if (!data.session) {
          setNotice('Check your inbox to confirm your email, then sign in.')
          setLoading(false)
          return
        }
        onSuccess(data.user, 'free')
      } else {
        const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
        if (authErr) throw authErr
        const { data: row } = await supabase
          .from('users').select('tier').eq('id', data.user.id).single()
        onSuccess(data.user, row?.tier || 'free')
      }
    } catch (err) {
      setError(friendlyAuthError(err.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal auth-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">{mode === 'login' ? 'Welcome back' : 'Create account'}</span>
            <h2 className="modal__title">{mode === 'login' ? 'Sign In' : 'Sign Up'}</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal__body">
          {prompt && <p className="auth-gate-banner">{prompt}</p>}
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="auth-email"><span className="label-icon">✉️</span> Email</label>
              <input id="auth-email" type="email" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="auth-password"><span className="label-icon">🔒</span> Password</label>
              <input id="auth-password" type="password"
                placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </div>
            {error  && <p className="error-banner">{error}</p>}
            {notice && <p className="auth-notice">{notice}</p>}
            <button type="submit" className="generate-btn" style={{ marginTop: 0 }} disabled={loading}>
              {loading
                ? <><span className="spinner" aria-hidden="true" /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
                : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <p className="auth-toggle">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button type="button" className="auth-toggle__btn"
              onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Sign up free' : 'Sign in'}
            </button>
          </p>
        </div>
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
        <h1 className="landing__name">PrepAI</h1>
        <p className="landing__tagline">
          AI meal planning that works with what you already have.
        </p>
        <button className="landing__cta" onClick={onEnter}>
          Try it free →
        </button>
      </div>
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
function MealSection({ type, name, day, onGetRecipe, onSwap, anySwapping, isOpen, onToggle }) {
  const { icon, label } = MEAL_META[type]
  const hasName    = Boolean(name)
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
          <button className="recipe-btn" onClick={() => onGetRecipe(name)}>
            📋 Get Recipe
          </button>
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
                <button className="dropdown-item" onClick={() => { onGetRecipe(name); onToggle() }}>
                  📋 Get Recipe
                </button>
                <a className="dropdown-item" href={googleUrl}
                  target="_blank" rel="noopener noreferrer" onClick={onToggle}>
                  🔍 Find on Google
                </a>
                <a className="dropdown-item" href={youtubeUrl}
                  target="_blank" rel="noopener noreferrer" onClick={onToggle}>
                  ▶ Find on YouTube
                </a>
                <button
                  className="dropdown-item dropdown-item--swap"
                  onClick={() => { onSwap(day); onToggle() }}
                  disabled={anySwapping}
                >
                  ⇄ Swap this day
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── MealCard ──────────────────────────────────────────────────────────────────
function MealCard({ day, content, isLoading, isSwapping, isSwapped, anySwapping, swapKey, onSwap, onUndo, onGetRecipe }) {
  const [openDropdown, setOpenDropdown] = useState(null)
  const cardRef = useRef(null)
  const meals = parseMealContent(content || '')
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
            <button
              className={`swap-btn${isSwapping ? ' swap-btn--spinning' : ''}`}
              onClick={() => onSwap(day)}
              disabled={anySwapping}
              title="Swap this day's meals"
            >
              {isSwapping ? <span className="swap-spinner" aria-hidden="true" /> : '⇄'}
            </button>
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
            {['breakfast', 'lunch', 'dinner'].map(type => (
              <MealSection
                key={type}
                type={type}
                name={meals[type]}
                day={day}
                onGetRecipe={onGetRecipe}
                onSwap={onSwap}
                anySwapping={anySwapping}
                isOpen={openDropdown === type}
                onToggle={() => setOpenDropdown(prev => prev === type ? null : type)}
              />
            ))}
            {meals.cost && <div className="meal-cost">{meals.cost}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── GrocerySection ────────────────────────────────────────────────────────────
function GrocerySection({ groceryByDay, groceryList, pantryItems, newIngredients }) {
  const [checked, setChecked] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('prepai_grocery_checked') || '[]')) }
    catch { return new Set() }
  })

  useEffect(() => {
    localStorage.setItem('prepai_grocery_checked', JSON.stringify([...checked]))
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

  function dl(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportAll() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    dl([
      'MEAL PREP GROCERY LIST', '======================', `Week of: ${dateStr}`, '',
      ...groceryList.map(i => `${checked.has(i.toLowerCase()) ? '☑' : '☐'}  ${i}${newIngredients.has(i.toLowerCase()) ? '  ← new' : ''}`),
      '', '─'.repeat(26), 'Generated by Meal Prep Planner',
    ].join('\n'), 'grocery-list.txt')
  }

  function exportUnchecked() {
    const remaining = groceryList.filter(i => !checked.has(i.toLowerCase()))
    if (!remaining.length) return
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    dl([
      'STILL NEEDED — GROCERY LIST', '============================', `Week of: ${dateStr}`, '',
      ...remaining.map(i => `☐  ${i}${newIngredients.has(i.toLowerCase()) ? '  ← new' : ''}`),
      '', '─'.repeat(26), 'Generated by Meal Prep Planner',
    ].join('\n'), 'grocery-list-remaining.txt')
  }

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
        {DAYS.map(day => {
          const items = groceryByDay[day]
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

      <div className="grocery-exports">
        <button className="export-btn" onClick={exportAll}>↓ Export all</button>
        <button className="export-btn export-btn--secondary" onClick={exportUnchecked}
          disabled={checkedCount === total && total > 0}>
          ↓ Export unchecked only
        </button>
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
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        const { data: row } = await supabase
          .from('users').select('tier').eq('id', session.user.id).single()
        setUserTier(row?.tier || 'free')
      }
    }
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) { setUser(null); setUserTier(null) }
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
    setUser(null)
    setUserTier(null)
    setFreeGenerationsUsed(0)
  }

  function openAuthModal(mode, prompt = '') {
    setAuthMode(mode)
    setAuthPrompt(prompt)
    setShowAuthModal(true)
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
    if (!budget.trim() || !goals.trim()) {
      setError('Please enter your weekly budget and dietary goals.')
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

    const forName = profile.name ? `for ${profile.name} ` : ''
    const prompt = `You are a professional nutritionist. Create a practical 5-day meal plan (Monday–Friday) ${forName}for:

Weekly Budget: $${budget}
Dietary Goals: ${goals}
Pantry Items: ${pantryItems.length ? pantryItems.join(', ') : 'None specified'}

Respond ONLY in this exact format — no intro or outro:

**MONDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**TUESDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**WEDNESDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**THURSDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**FRIDAY**
Breakfast: [brief meal description]
Lunch: [brief meal description]
Dinner: [brief meal description]
• Estimated cost: $[amount]

**GROCERY LIST**
MONDAY
• [ingredient]
• [ingredient]

TUESDAY
• [ingredient]
• [ingredient]

WEDNESDAY
• [ingredient]
• [ingredient]

THURSDAY
• [ingredient]
• [ingredient]

FRIDAY
• [ingredient]
• [ingredient]

(List ingredients needed for each specific day. Simple grocery names only — no amounts, no prep notes, no duplicates within a day.)

Keep meals practical, budget-friendly, and aligned with the dietary goals. Use pantry items where possible.`

    try {
      await withRetry(
        async () => {
          let fullText = ''
          const plan = Object.fromEntries(DAYS.map(d => [d, '']))
          const stream = await client.messages.stream({
            model: 'claude-opus-4-7', max_tokens: 4096,
            thinking: { type: 'adaptive' },
            messages: [{ role: 'user', content: prompt }],
          })
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              fullText += chunk.delta.text
              for (let i = 0; i < DAYS.length; i++) {
                const day = DAYS[i]
                const marker = `**${day.toUpperCase()}**`
                const start = fullText.indexOf(marker)
                if (start === -1) continue
                const nextMarker = DAYS[i + 1] ? `**${DAYS[i + 1].toUpperCase()}**` : '**GROCERY LIST**'
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
                  const matchedDay = DAYS.find(d => line.toUpperCase() === d.toUpperCase())
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
              <h1 className="app-header__title">Meal Prep Planner</h1>
              <p className="app-header__subtitle">AI-powered weekly meal plans tailored to your budget &amp; goals</p>
            </div>
          </div>
          <div className="app-header__right">
            <button
              className={`profile-toggle-btn${showProfile ? ' profile-toggle-btn--active' : ''}`}
              onClick={() => setShowProfile(v => !v)}
            >
              👤 {profile.name || 'My Profile'}
            </button>
            {user ? (
              <div className="header-auth">
                <span className="header-auth__email" title={user.email}>{user.email}</span>
                {userTier && userTier !== 'free' && (
                  <span className="header-auth__tier">{userTier}</span>
                )}
                <button className="header-auth__signout" onClick={handleLogout}>Sign out</button>
              </div>
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
          <div className="form-card">
            <div className="form-group">
              <label htmlFor="budget"><span className="label-icon">💰</span> Weekly Budget</label>
              <div className="input-wrap input-wrap--prefix">
                <span className="input-prefix">$</span>
                <input id="budget" type="number" min="1" placeholder="75"
                  value={budget} onChange={e => setBudget(e.target.value)} disabled={loading} />
              </div>
            </div>

            <div className="presets-group">
              <p className="presets-label">Quick picks</p>
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
            </div>

            <div className="form-group">
              <label htmlFor="goals"><span className="label-icon">🎯</span> Dietary Goals</label>
              <input id="goals" type="text"
                placeholder="e.g. high protein, low carb, vegetarian, weight loss…"
                value={goals} onChange={e => setGoals(e.target.value)} disabled={loading} />
            </div>

            <div className="form-group">
              <label><span className="label-icon">🧺</span> Pantry Items <span className="label-optional">(optional)</span></label>

              <button type="button"
                className={`scan-btn-full${scanningPhoto ? ' scan-btn-full--loading' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                disabled={scanningPhoto || loading}
              >
                {scanningPhoto
                  ? <><span className="scan-spinner" aria-hidden="true" /> Scanning photo…</>
                  : <><span className="scan-btn-full__icon">📷</span> Scan Your Pantry</>}
              </button>

              {scanError && <p className="scan-error">{scanError}</p>}

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

              {pantryItems.length > 0 && (
                <button type="button" className="pantry-generate-btn"
                  onClick={handleGenerate} disabled={loading}>
                  {loading
                    ? <><span className="spinner" aria-hidden="true" /> {retryStatus || 'Generating…'}</>
                    : '✓ Looks good, generate plan'}
                </button>
              )}
            </div>
            {error && <p className="error-banner">{error}</p>}
            <button className={`generate-btn${loading ? ' generate-btn--loading' : ''}`}
              onClick={handleGenerate} disabled={loading}>
              {loading
                ? <><span className="spinner" aria-hidden="true" /> {retryStatus || 'Generating meal plan…'}</>
                : '✨ Generate 5-Day Meal Plan'}
            </button>
          </div>
        </section>

        {(hasResults || loading) && (
          <section className="results-section">
            <h2 className="results-title">Your 5-Day Meal Plan</h2>
            <div className="cards-grid">
              {DAYS.map((day, i) => (
                <MealCard
                  key={day}
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
                />
              ))}
            </div>
          </section>
        )}

        {!loading && groceryList.length > 0 && (
          <GrocerySection
            groceryByDay={groceryByDay}
            groceryList={groceryList}
            pantryItems={pantryItems}
            newIngredients={newIngredients}
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
