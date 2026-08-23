export type ObservatoryPagesEnv = Env & {
  GITHUB_WEBHOOK_SECRET: string;
};

export interface ObservatoryPagesContext {
  request: Request;
  env: ObservatoryPagesEnv;
  next: () => Promise<Response>;
  params: Record<string, string | undefined>;
}

export type ObservatoryPagesFunction = (
  context: ObservatoryPagesContext,
) => Response | Promise<Response>;
