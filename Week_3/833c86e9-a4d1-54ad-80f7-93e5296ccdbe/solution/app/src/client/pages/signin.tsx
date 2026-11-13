import '../styles/account.css'
import { AuthForm } from '../components/auth-form'
import { Link } from '../router'
import { useApp } from '../state'

export function SignInPage() {
  const app = useApp()
  return (
    <>
      <AuthForm mode="signin" />
      <p className="auth-alt"><Link to="/signup" className="btn quiet">{app.t('ui.createAccount')}</Link></p>
    </>
  )
}
