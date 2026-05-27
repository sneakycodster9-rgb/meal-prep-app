import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SuccessPage from './SuccessPage.jsx'

const isSuccess = window.location.pathname === '/success'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSuccess ? <SuccessPage /> : <App />}
  </StrictMode>,
)
