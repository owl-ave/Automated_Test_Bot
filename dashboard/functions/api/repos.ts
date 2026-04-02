import { GitHubAppEnv, getInstalledRepos } from './_github-app';

export const onRequestGet: PagesFunction<GitHubAppEnv> = async (context) => {
  if (!context.env.APP_ID || !context.env.APP_PRIVATE_KEY_B64) {
    return Response.json({ error: 'APP_ID and APP_PRIVATE_KEY_B64 not configured' }, { status: 500 });
  }

  try {
    const repos = await getInstalledRepos(context.env);
    return Response.json(repos.map((r: any) => ({
      fullName: r.full_name,
      owner: r.owner.login,
      name: r.name,
      defaultBranch: r.default_branch,
      private: r.private,
    })));
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};
