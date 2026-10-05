import Link from 'next/link';
import { AudioLines } from 'lucide-react';

interface AuthShellProps {
  children: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}

export function AuthShell({ children, description, eyebrow, title }: AuthShellProps) {
  return (
    <main className="auth-layout">
      <section className="auth-intro" aria-labelledby="auth-title">
        <Link className="brand auth-brand" href="/" aria-label="DamdAImin home">
          <span>
            Damd<span className="auth-brand-accent">AI</span>min
          </span>
          <img src="/landing/brand-mark.svg" alt="" aria-hidden="true" />
        </Link>
        <div className="auth-intro-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="auth-title">{title}</h1>
          <p className="intro-description">{description}</p>
        </div>
        <div className="signal-note">
          <AudioLines className="signal-mark" aria-hidden="true" />
          <p>
            A private workspace for understanding how one utterance is classified. Your account owns
            the records it creates.
          </p>
        </div>
      </section>
      <section className="auth-panel" aria-label="Account access">
        <div className="auth-card">{children}</div>
      </section>
    </main>
  );
}

export function FormMessage({
  children,
  tone = 'error',
}: {
  children: React.ReactNode;
  tone?: 'error' | 'info';
}) {
  return (
    <p
      className={`form-message form-message-${tone}`}
      role={tone === 'error' ? 'alert' : undefined}
      aria-live="polite"
    >
      {children}
    </p>
  );
}

export function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className="form-footer">{children}</div>;
}
