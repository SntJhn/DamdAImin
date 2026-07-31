import { VerifyForm } from '../../../components/auth-forms';

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  return <VerifyForm initialEmail={params.email ?? ''} />;
}
