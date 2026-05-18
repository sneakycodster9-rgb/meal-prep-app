import { useState, useRef, useEffect } from 'react'
import Anthropic from '@anthropic-ai/sdk'
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

const MEAL_META = {
  breakfast: { icon: '☀️', label: 'Breakfast' },
  lunch:     { icon: '🍴', label: 'Lunch' },
  dinner:    { icon: '🌙', label: 'Dinner' },
}

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

// ── LandingPage ───────────────────────────────────────────────────────────────
function LandingPage({ onEnter }) {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleEmail(e) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    const list = JSON.parse(localStorage.getItem('prepai_emails') || '[]')
    list.push({ email: trimmed, ts: new Date().toISOString() })
    localStorage.setItem('prepai_emails', JSON.stringify(list))
    setSubmitted(true)
  }

  return (
    <div className="landing">
      <div className="landing__content">
        <div className="landing__logo">🥗</div>
        <h1 className="landing__name">PrepAI</h1>
        <p className="landing__tagline">
          AI-powered weekly meal plans tailored to your budget &amp; goals — in seconds.
        </p>
        <button className="landing__cta" onClick={onEnter}>
          Try it free →
        </button>
        <div className="landing__email-section">
          <p className="landing__email-label">Get early access when we launch</p>
          {submitted ? (
            <p className="landing__email-success">✓ You're on the list!</p>
          ) : (
            <form className="landing__email-form" onSubmit={handleEmail}>
              <input
                type="email"
                className="landing__email-input"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <button type="submit" className="landing__email-btn">Notify me</button>
            </form>
          )}
          <p className="landing__no-spam">No spam, ever. Unsubscribe anytime.</p>
        </div>
      </div>
    </div>
  )
}

// ── PricingPopup ──────────────────────────────────────────────────────────────
const PRICING_OPTIONS = [
  { id: 'basic',    price: '$3/month',  tier: 'Basic' },
  { id: 'standard', price: '$5/month',  tier: 'Standard', popular: true },
  { id: 'pro',      price: '$8/month',  tier: 'Pro' },
  { id: 'skip',     price: "I wouldn't pay for this", tier: null },
]

function PricingPopup({ onClose }) {
  const [chosen, setChosen] = useState(null)

  function handleChoice(opt) {
    if (chosen) return
    setChosen(opt.id)
    const label = opt.tier ? `${opt.price} - ${opt.tier}` : opt.price
    const log = JSON.parse(localStorage.getItem('prepai_pricing') || '[]')
    log.push({ choice: opt.id, label, ts: new Date().toISOString() })
    localStorage.setItem('prepai_pricing', JSON.stringify(log))
    setTimeout(onClose, 900)
  }

  return (
    <div className="pricing-backdrop" onMouseDown={onClose}>
      <div className="pricing-modal" onMouseDown={e => e.stopPropagation()}>
        <button className="pricing-modal__close" onClick={onClose} aria-label="Close">✕</button>
        <div className="pricing-modal__emoji">🎉</div>
        <h2 className="pricing-modal__title">Enjoying PrepAI?</h2>
        <p className="pricing-modal__subtitle">
          We're building the full version. Tell us what you'd pay:
        </p>
        <div className="pricing-options">
          {PRICING_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className={[
                'pricing-option',
                opt.popular  ? 'pricing-option--popular'  : '',
                !opt.tier    ? 'pricing-option--skip'     : '',
                chosen === opt.id ? 'pricing-option--chosen' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleChoice(opt)}
              disabled={!!chosen}
            >
              {opt.popular && <span className="pricing-option__badge">Most popular</span>}
              {opt.tier ? (
                <>
                  <span className="pricing-option__price">{opt.price}</span>
                  <span className="pricing-option__tier">{opt.tier}</span>
                </>
              ) : (
                <span className="pricing-option__skip-label">{opt.price}</span>
              )}
              {chosen === opt.id && <span className="pricing-option__check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
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

              {parsed.ingredients.length > 0 && (
                <div>
                  <h3 className="modal__section-title">Ingredients</h3>
                  <ul className="modal__ingredient-list">
                    {parsed.ingredients.map((ing, i) => (
                      <li key={i} className={`modal__ingredient${ing.includes('✓') ? ' modal__ingredient--pantry' : ''}`}>
                        {ing}
                      </li>
                    ))}
                  </ul>
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
function GrocerySection({ items, newIngredients, onExport }) {
  if (!items.length) return null
  return (
    <section className="grocery-section">
      <div className="grocery-header">
        <h2 className="grocery-title">🛒 Grocery List</h2>
        <button className="export-btn" onClick={onExport}>↓ Export .txt</button>
      </div>
      <ul className="grocery-list">
        {items.map((item, i) => {
          const isNew = newIngredients.has(item.toLowerCase())
          return (
            <li key={i} className={`grocery-item${isNew ? ' grocery-item--new' : ''}`}>
              {isNew && <span className="new-badge">new</span>}
              <span className="grocery-item__name">{item}</span>
              <div className="grocery-item__links">
                <a href={walmartUrl(item)}
                  target="_blank" rel="noopener noreferrer" className="shop-link shop-link--walmart">Walmart</a>
                <a href={amazonUrl(item)}
                  target="_blank" rel="noopener noreferrer" className="shop-link shop-link--amazon">Amazon</a>
              </div>
            </li>
          )
        })}
      </ul>
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
  const [pantry, setPantry] = useState('')
  const [mealPlan, setMealPlan] = useState(null)
  const [groceryList, setGroceryList] = useState([])
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
  const [showPricing, setShowPricing] = useState(false)
  const [pricingShown, setPricingShown] = useState(false)

  function handleProfileSave(saved) {
    setProfile(saved)
    const parts = [saved.restrictions, saved.cuisines].filter(Boolean)
    if (parts.length) setGoals(parts.join(', '))
  }

  async function handlePhotoScan(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setScanningPhoto(true); setScanError('')
    const identified = new Set(pantry.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    for (const file of files) {
      try {
        const base64 = await resizeImage(file)
        const response = await client.messages.create({
          model: 'claude-opus-4-7', max_tokens: 512,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: 'Look at this photo of a pantry, fridge, or kitchen. List every visible food ingredient or grocery item you can identify. Return ONLY a comma-separated list of ingredient names (e.g. "eggs, milk, cheddar cheese, olive oil, chicken breast"). No explanations, no amounts, just the names.' },
          ]}],
        })
        const text = response.content.find(c => c.type === 'text')?.text ?? ''
        text.split(',').forEach(raw => {
          const item = raw.trim().replace(/[.!?]$/, '').toLowerCase()
          if (item.length > 2) identified.add(item)
        })
        setScannedCount(n => n + 1)
      } catch (err) { setScanError(`Scan failed: ${err.message}`) }
    }
    setPantry(Array.from(identified).join(', '))
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
      const response = await client.messages.create({
        model: 'claude-opus-4-7', max_tokens: 768,
        messages: [{ role: 'user', content: prompt }],
      })
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
    const pantryText = pantry.trim()
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
      const response = await client.messages.create({
        model: 'claude-opus-4-7', max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      })
      const content = response.content.find(c => c.type === 'text')?.text ?? ''
      setRecipe({ mealName, loading: false, content })
    } catch (err) {
      setRecipe({ mealName, loading: false, content: '', error: err.message })
    }
  }

  function exportGroceryList() {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const text = [
      'MEAL PREP GROCERY LIST', '======================', `Week of: ${dateStr}`, '',
      ...groceryList.map(item => `☐  ${item}${newIngredients.has(item.toLowerCase()) ? '  ← new' : ''}`),
      '', '─'.repeat(26), 'Generated by Meal Prep Planner',
    ].join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'grocery-list.txt'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleGenerate() {
    if (!budget.trim() || !goals.trim()) {
      setError('Please enter your weekly budget and dietary goals.')
      return
    }
    setError(''); setLoading(true); setMealPlan(null); setGroceryList([])
    setActiveDay(0); setSwapHistory({}); setSwappedDays(new Set())
    setSwapKeys({}); setNewIngredients(new Set()); setRecipe(null)
    let succeeded = false

    const forName = profile.name ? `for ${profile.name} ` : ''
    const prompt = `You are a professional nutritionist. Create a practical 5-day meal plan (Monday–Friday) ${forName}for:

Weekly Budget: $${budget}
Dietary Goals: ${goals}
Pantry Items: ${pantry.trim() || 'None specified'}

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
• [ingredient]
• [ingredient]
(List every unique ingredient needed across all 5 days. Simple grocery names only — no amounts, no prep notes, no duplicates.)

Keep meals practical, budget-friendly, and aligned with the dietary goals. Use pantry items where possible.`

    try {
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
            const items = fullText.slice(gStart + gMarker.length).trim().split('\n')
              .filter(l => /^[•\-\*]/.test(l.trim()))
              .map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean)
            setGroceryList(items)
          }
        }
      }
      setActiveDay(-1)
      succeeded = true
    } catch (err) {
      const msg = err?.message ?? String(err)
      setError(msg.includes('401') || msg.toLowerCase().includes('api key')
        ? 'Invalid API key — check VITE_ANTHROPIC_KEY in your .env file.'
        : `Error: ${msg}`)
    } finally {
      setLoading(false)
      if (succeeded && !pricingShown) {
        setShowPricing(true)
        setPricingShown(true)
      }
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
          <button
            className={`profile-toggle-btn${showProfile ? ' profile-toggle-btn--active' : ''}`}
            onClick={() => setShowProfile(v => !v)}
          >
            👤 {profile.name || 'My Profile'}
          </button>
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
            <div className="form-group">
              <label htmlFor="goals"><span className="label-icon">🎯</span> Dietary Goals</label>
              <input id="goals" type="text"
                placeholder="e.g. high protein, low carb, vegetarian, weight loss…"
                value={goals} onChange={e => setGoals(e.target.value)} disabled={loading} />
            </div>
            <div className="form-group">
              <div className="pantry-label-row">
                <label htmlFor="pantry">
                  <span className="label-icon">🧺</span> Pantry Items
                  <span className="label-optional"> (optional)</span>
                </label>
                <button type="button" className={`scan-btn${scanningPhoto ? ' scan-btn--loading' : ''}`}
                  onClick={() => fileInputRef.current?.click()} disabled={scanningPhoto || loading}>
                  {scanningPhoto ? <><span className="scan-spinner" aria-hidden="true" /> Scanning…</> : <>📷 Scan Photo</>}
                </button>
              </div>
              {scannedCount > 0 && !scanningPhoto && (
                <p className="scan-success">✓ {scannedCount} photo{scannedCount !== 1 ? 's' : ''} scanned — ingredients added below</p>
              )}
              {scanError && <p className="scan-error">{scanError}</p>}
              <textarea id="pantry" rows={3}
                placeholder="e.g. rice, canned beans, olive oil, eggs, chicken breast… (or scan a photo above)"
                value={pantry} onChange={e => setPantry(e.target.value)} disabled={loading} />
              <input ref={fileInputRef} type="file" accept="image/*" multiple
                style={{ display: 'none' }} onChange={handlePhotoScan} />
            </div>
            {error && <p className="error-banner">{error}</p>}
            <button className={`generate-btn${loading ? ' generate-btn--loading' : ''}`}
              onClick={handleGenerate} disabled={loading}>
              {loading
                ? <><span className="spinner" aria-hidden="true" /> Generating meal plan…</>
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
          <GrocerySection items={groceryList} newIngredients={newIngredients} onExport={exportGroceryList} />
        )}
      </main>

      {recipe && <RecipeModal recipe={recipe} onClose={() => setRecipe(null)} />}
      {showPricing && <PricingPopup onClose={() => setShowPricing(false)} />}
    </div>
  )
}
