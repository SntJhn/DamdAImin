'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { authClient } from '../lib/auth-client';
import { AuthShell, FormFooter, FormMessage } from './auth-shell';

function safeNext(value: string | null): string {
  return value === '/history' ? value : '/history';
}

function genericAuthError(): string {
  return 'That request could not be completed. Check the fields and try again.';
}

function Field({
  autoComplete,
  children,
  id,
  inputMode,
  label,
  minLength,
  name,
  type = 'text',
  value,
  onChange,
}: {
  autoComplete?: string;
  children?: React.ReactNode;
  id: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  label: string;
  minLength?: number;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        minLength={minLength}
        required
        onChange={(event) => onChange(event.target.value)}
      />
      {children}
    </label>
  );
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const result = await authClient.signIn.email({ email, password, callbackURL: '/history' });
      if (result.error) {
        setError(genericAuthError());
        return;
      }

      router.replace(safeNext(searchParams.get('next')));
    } catch {
      setError(genericAuthError());
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Account access"
      title="Keep your signal history close."
      description="Sign in to return to your private Analysis History."
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="form-heading">
          <p className="card-kicker">Welcome back</p>
          <h2>Sign in</h2>
        </div>
        <Field
          id="sign-in-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        <Field
          id="sign-in-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <FormFooter>
          <Link href="/auth/forgot-password">Forgot password?</Link>
          <span>
            New here? <Link href="/auth/sign-up">Create an account</Link>
          </span>
        </FormFooter>
      </form>
    </AuthShell>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const result = await authClient.signUp.email({ name, email, password });
      if (result.error) {
        setError(genericAuthError());
        return;
      }

      router.replace(`/auth/verify?email=${encodeURIComponent(email)}`);
    } catch {
      setError(genericAuthError());
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Start privately"
      title="Make room for the next clear read."
      description="Create an account to keep Analysis Records under your control."
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="form-heading">
          <p className="card-kicker">New account</p>
          <h2>Register</h2>
        </div>
        <Field
          id="sign-up-name"
          name="name"
          label="Your name"
          autoComplete="name"
          value={name}
          onChange={setName}
        />
        <Field
          id="sign-up-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        <Field
          id="sign-up-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        >
          <small className="field-hint">Use at least 8 characters.</small>
        </Field>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <FormFooter>
          <span>
            Already registered? <Link href="/auth/sign-in">Sign in</Link>
          </span>
        </FormFooter>
      </form>
    </AuthShell>
  );
}

export function VerifyForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function resend() {
    setError('');
    setMessage('');
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'email-verification',
      });
      if (result.error) {
        setError(genericAuthError());
        return;
      }

      setMessage('A new verification code is on its way.');
    } catch {
      setError(genericAuthError());
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await authClient.emailOtp.verifyEmail({ email, otp });
      if (result.error) {
        setError('That code was not accepted. Request a new one and try again.');
        return;
      }

      router.replace('/history');
    } catch {
      setError('That code was not accepted. Request a new one and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Verify account"
      title="One small proof, then your history is yours."
      description="Enter the one-time code sent to your email address before continuing."
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="form-heading">
          <p className="card-kicker">Email verification</p>
          <h2>Enter your code</h2>
        </div>
        <Field
          id="verify-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        <Field
          id="verify-otp"
          name="otp"
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={setOtp}
        />
        {error ? <FormMessage>{error}</FormMessage> : null}
        {message ? <FormMessage tone="info">{message}</FormMessage> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Verifying…' : 'Verify email'}
        </button>
        <FormFooter>
          <button className="text-button" type="button" onClick={resend}>
            Send a new code
          </button>
          <Link href="/auth/sign-in">Back to sign in</Link>
        </FormFooter>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const result = await authClient.emailOtp.requestPasswordReset({ email });
      if (result.error) {
        setError(genericAuthError());
        return;
      }

      router.replace(`/auth/reset-password?email=${encodeURIComponent(email)}`);
    } catch {
      setError(genericAuthError());
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Recover access"
      title="A locked door is not a dead end."
      description="Request a one-time code to set a new password for your existing account."
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="form-heading">
          <p className="card-kicker">Password recovery</p>
          <h2>Request a code</h2>
        </div>
        <Field
          id="forgot-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Sending code…' : 'Send recovery code'}
        </button>
        <FormFooter>
          <span>
            Remembered it? <Link href="/auth/sign-in">Back to sign in</Link>
          </span>
        </FormFooter>
      </form>
    </AuthShell>
  );
}

export function ResetPasswordForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const result = await authClient.emailOtp.resetPassword({ email, otp, password });
      if (result.error) {
        setError('That recovery code was not accepted. Request a new one and try again.');
        return;
      }

      router.replace('/auth/sign-in?recovered=1');
    } catch {
      setError('That recovery code was not accepted. Request a new one and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Set a new password"
      title="Return to the work that is yours."
      description="Use the code from your recovery email. This updates the existing account."
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="form-heading">
          <p className="card-kicker">Password recovery</p>
          <h2>Choose a new password</h2>
        </div>
        <Field
          id="reset-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        <Field
          id="reset-otp"
          name="otp"
          label="Recovery code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={setOtp}
        />
        <Field
          id="reset-password"
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Updating password…' : 'Update password'}
        </button>
        <FormFooter>
          <Link href="/auth/sign-in">Back to sign in</Link>
        </FormFooter>
      </form>
    </AuthShell>
  );
}
