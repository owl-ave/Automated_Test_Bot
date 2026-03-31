import { GitHubAppEnv, ghHeaders } from './_github-app';

export const onRequestGet: PagesFunction<GitHubAppEnv> = async (context) => {
  const token = context.env.GITHUB_PAT;
  if (!token) return Response.json({ error: 'GITHUB_PAT not configured' }, { status: 500 });

  try {
    const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: ghHeaders(token),
    });
    const data = (await res.json()) as any[];

    const repos = data.map((r: any) => ({
      fullName: r.full_name, owner: r.owner.login, name: r.name, defaultBranch: r.default_branch, private: r.private,
    }));
    return Response.json(repos);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
