import { ResetPasswordForm } from '../../../components/auth-forms';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  return <ResetPasswordForm initialEmail={params.email ?? ''} />;
}
