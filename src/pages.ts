export interface ObservatoryPagesContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  params: Record<string, string | undefined>;
}

export type ObservatoryPagesFunction = (
  context: ObservatoryPagesContext,
) => Response | Promise<Response>;
