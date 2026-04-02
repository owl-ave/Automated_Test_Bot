import { GitHubAppEnv, getTokenForRepo, ghHeaders } from './_github-app';

export const onRequestGet: PagesFunction<GitHubAppEnv> = async (context) => {
  const url = new URL(context.request.url);
  const owner = url.searchParams.get('owner');
  const repo = url.searchParams.get('repo');

  if (!owner || !repo) {
    return Response.json({ error: 'owner and repo query params required' }, { status: 400 });
  }

  try {
    const token = await getTokenForRepo(context.env, owner, repo);
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50`, {
      headers: ghHeaders(token),
    });
    const data = (await res.json()) as any[];
    const pulls = data.map((pr: any) => ({
      number: pr.number, title: pr.title, branch: pr.head.ref, author: pr.user.login, createdAt: pr.created_at,
    }));
    return Response.json(pulls);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
