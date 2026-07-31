import { getAuth } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

type AuthRouteContext = {
  params: Promise<{ path: string[] }>;
};

function route(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH') {
  return (request: Request, context: AuthRouteContext) =>
    getAuth().handler()[method](request, context);
}

export const GET = route('GET');
export const POST = route('POST');
export const PUT = route('PUT');
export const DELETE = route('DELETE');
export const PATCH = route('PATCH');
