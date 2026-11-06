import { useNavigate } from 'react-router';

export function SignOutButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="sign-out"
      id="sign-out"
      onClick={async () => {
        try {
          await fetch('/api/session', { method: 'DELETE' });
        } finally {
          navigate('/login?signed-out=1', { replace: true });
        }
      }}
    >
      Sign out
    </button>
  );
}
