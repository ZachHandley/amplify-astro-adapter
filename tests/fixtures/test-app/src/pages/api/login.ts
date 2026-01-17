import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ session, request, redirect }) => {
  const formData = await request.formData();
  const username = formData.get('username') as string;
  session?.set('username', username);
  session?.set('loggedInAt', new Date().toISOString());
  return redirect('/');
};
